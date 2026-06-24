// 2026-06-06: agent service entry point.
//
// A small Node service that runs on a remote machine and:
//   - Holds a pool of Playwright BrowserServer instances (one per
//     launchKey), and accepts launch requests from the central server
//   - Generates reports locally, then ships them back via HTTP tarball
//   - Heartbeats every 30s to keep its device row's last_seen_at fresh
//   - On SIGTERM, sends a one-shot /shutdown so the server marks the
//     device offline immediately
//
// Run with: `npm run agent` (uses tsx for dev) or `node dist/agent/index.js`
// after `npm run build:agent`.
//
// Required env:
//   AGENT_TOKEN     — per-device bearer (must match a row in `devices`)
//   AGENT_SERVER_URL — central server base URL, e.g. http://localhost:3000
// Optional:
//   AGENT_PORT      — listen port (default 4001)
//   AGENT_NAME      — log prefix (default 'agent')
//   PLAYWRIGHT_BROWSERS_PATH / AGENT_BROWSERS_PATH — chromium install
//   AGENT_REPORT_TEMP_ROOT — where Midscene writes per-session reports

import express from 'express';
import cors from 'cors';
import { verifyServerRequest } from './auth.js';
import { getOrLaunch, touchSession, shutdownSession, getSessionDir, getActiveSessions, startCleanupLoop, shutdownAll } from './launch.js';
import { tarGzDir } from './report.js';
import { startHeartbeatLoop, stopHeartbeatLoop, sendShutdown } from './heartbeat.js';

const AGENT_PORT = Number(process.env.AGENT_PORT || 4001);
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL;
const AGENT_NAME = process.env.AGENT_NAME || 'agent';

if (!AGENT_TOKEN) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_TOKEN env var is required`);
  process.exit(1);
}
if (!AGENT_SERVER_URL) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_SERVER_URL env var is required`);
  process.exit(1);
}

const app = express();
app.use(express.json());

// CORS: only the central server should be calling us. In dev, also allow
// localhost origins for ad-hoc curl/browser inspection. Production
// deployments should set AGENT_CORS_ORIGIN to the central server's URL.
const corsOrigin = process.env.AGENT_CORS_ORIGIN || AGENT_SERVER_URL;
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: false }));

// Healthcheck — open (no auth) so ops can hit it without a token. Used
// by the central server to confirm reachability and by the "测试连接"
// button in the UI.
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    name: AGENT_NAME,
    version: '0.1.0',
    activeSessions: getActiveSessions(),
  });
});

// All other routes require the central server's bearer token (== our
// AGENT_TOKEN; mirror auth — see auth.ts comments).
app.use(verifyServerRequest);

// POST /launch
// Body: { browserName, headless, executablePath?, chromiumSandbox? }
// Returns: { wsEndpoint, sessionId, reportTempDir }
// - wsEndpoint: the central server connects to this via playwright.connect()
// - sessionId: pass back to /sessions/:id/{heartbeat,report,shutdown}
// - reportTempDir: where Midscene writes its report. The central server
//   downloads this via GET /sessions/:id/report.
app.post('/launch', async (req, res) => {
  const { browserName, headless, executablePath, chromiumSandbox, args } = req.body || {};
  if (typeof browserName !== 'string' || !['chromium', 'firefox', 'webkit'].includes(browserName)) {
    res.status(400).json({ code: 400, message: 'browserName must be chromium|firefox|webkit' });
    return;
  }
  if (typeof headless !== 'boolean') {
    res.status(400).json({ code: 400, message: 'headless must be boolean' });
    return;
  }
  try {
    const r = await getOrLaunch({ browserName, headless, executablePath, chromiumSandbox, args });
    console.log(`[${AGENT_NAME}:launch] issued wsEndpoint=${r.wsEndpoint} sessionId=${r.sessionId} reportTempDir=${r.reportTempDir}`);
    res.json({
      code: 200,
      message: 'ok',
      data: {
        wsEndpoint: r.wsEndpoint,
        sessionId: r.sessionId,
        reportTempDir: r.reportTempDir,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${AGENT_NAME}:launch] failed: ${msg}`);
    res.status(500).json({ code: 500, message: `launch failed: ${msg}` });
  }
});

// POST /sessions/:id/heartbeat — touch lastUsedAt
app.post('/sessions/:id/heartbeat', (req, res) => {
  const ok = touchSession(req.params.id);
  if (!ok) {
    res.status(404).json({ code: 404, message: 'Session not found' });
    return;
  }
  res.json({ code: 200, message: 'ok' });
});

// GET /sessions/:id/report — gzipped tarball of the report dir
app.get('/sessions/:id/report', async (req, res) => {
  const dir = getSessionDir(req.params.id);
  if (!dir) {
    res.status(404).json({ code: 404, message: 'Session not found' });
    return;
  }
  try {
    const buf = await tarGzDir(dir);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.id}.tar.gz"`);
    res.end(buf);
    console.log(`[${AGENT_NAME}:report] shipped sessionId=${req.params.id} bytes=${buf.length}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${AGENT_NAME}:report] failed sessionId=${req.params.id}: ${msg}`);
    res.status(500).json({ code: 500, message: msg });
  }
});

// POST /sessions/:id/shutdown — close the session (does NOT close the
// shared browser server — that follows the launchKey idle TTL).
app.post('/sessions/:id/shutdown', async (req, res) => {
  const ok = await shutdownSession(req.params.id);
  if (!ok) {
    res.status(404).json({ code: 404, message: 'Session not found' });
    return;
  }
  res.json({ code: 200, message: 'ok' });
});

const server = app.listen(AGENT_PORT, () => {
  console.log(`[${AGENT_NAME}] listening on http://0.0.0.0:${AGENT_PORT} (server=${AGENT_SERVER_URL})`);
  console.log(`[${AGENT_NAME}] PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'}`);
  startCleanupLoop();
  startHeartbeatLoop({ serverUrl: AGENT_SERVER_URL, agentToken: AGENT_TOKEN, agentPort: AGENT_PORT });
});

// Graceful shutdown. Order matters:
//  1. Stop accepting new requests
//  2. Tell the central server we're offline (so the device row flips
//     to offline immediately, instead of waiting 90s for stale detection)
//  3. Close all browser servers (kills Chromium processes)
//  4. Exit
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[${AGENT_NAME}] received ${signal}, shutting down...`);
  stopHeartbeatLoop();
  try {
    await sendShutdown({ serverUrl: AGENT_SERVER_URL!, agentToken: AGENT_TOKEN!, agentPort: AGENT_PORT });
  } catch (e) {
    console.log(`[${AGENT_NAME}] sendShutdown error: ${e instanceof Error ? e.message : String(e)}`);
  }
  server.close();
  await shutdownAll();
  process.exit(0);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
