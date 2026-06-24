// 2026-06-15: pc-agent service entry point.
//
// Independent Node service running on the target PC (Linux/Mac/Win).
// Listens on AGENT_PC_PORT (default 4003, distinct from web 4001 / mobile 4002).
//
// Architecture difference from web-agent:
//   - web-agent: server calls /launch → agent starts browser → returns
//     wsEndpoint → server connects Playwright over WS and drives remotely.
//   - pc-agent:   server calls /execute → agent runs the WHOLE case on
//     this machine → returns result → server calls /report to fetch the
//     tarballed report. We can't expose a "drive remotely" endpoint
//     because ComputerDevice (libnut keyboard/mouse + screenshot-desktop)
//     is bound to this machine's physical hardware.
//
// Lifecycle:
//   1. systemd/launchd starts this process with AGENT_TOKEN +
//      AGENT_SERVER_URL env vars.
//   2. heartbeat.ts registers with the central server (kind='pc'),
//      which writes agent_endpoint into the devices row.
//   3. When a PC case targets this device, the server's pc-executor
//      POSTs /execute → we run it → return PcAgentExecResult.
//   4. Server GETs /sessions/:id/report → we tar.gz the report dir
//      and stream it back.

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { verifyServerRequest } from './auth.js';
import { startHeartbeatLoop, stopHeartbeatLoop, sendShutdown } from './heartbeat.js';
import { executeOnAgent, parseCheckpoints, type PcAgentExecResult } from './execute.js';
import { tarGzDir } from './report.js';

const AGENT_PC_PORT = Number(process.env.AGENT_PC_PORT || 4003);
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL;
const AGENT_NAME = process.env.AGENT_NAME || 'pc-agent';

if (!AGENT_TOKEN) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_TOKEN env var is required`);
  process.exit(1);
}
if (!AGENT_SERVER_URL) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_SERVER_URL env var is required`);
  process.exit(1);
}

// In-memory session store: maps sessionId → { result, reportDir }.
// The server uses the sessionId returned by /execute to GET /report.
// Cleared on process restart (acceptable — reports are transient).
interface SessionEntry {
  result: PcAgentExecResult;
  reportDir?: string;
  createdAt: number;
}
const sessions = new Map<string, SessionEntry>();
// GC: drop sessions older than 30 min to bound memory.
const SESSION_TTL_MS = 30 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60_000).unref?.();

const app = express();
app.use(express.json({ limit: '64mb' }));

const corsOrigin = process.env.AGENT_CORS_ORIGIN || AGENT_SERVER_URL;
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: false }));

// /healthz — open, no auth
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, name: AGENT_NAME, kind: 'pc', port: AGENT_PC_PORT, active_sessions: sessions.size });
});

// All routes below require bearer auth.
app.use(verifyServerRequest);

// POST /execute — run a complete PC test case on this machine.
// Body: ExecuteRequest → { sessionId, result: PcAgentExecResult }
app.post('/execute', async (req, res) => {
  const body = req.body || {};
  if (typeof body.content !== 'string' || !body.content) {
    // Allow content-less runs (precondition + checkpoints only), but
    // require SOMETHING to do.
    if (!body.preconditionText && !body.checkpoints?.length) {
      res.status(400).json({ code: 400, message: 'content, preconditionText, or checkpoints is required' });
      return;
    }
  }
  try {
    const result = await executeOnAgent({
      groupName: typeof body.groupName === 'string' ? body.groupName : 'pc-case',
      groupDescription: typeof body.groupDescription === 'string' ? body.groupDescription : undefined,
      reportName: typeof body.reportName === 'string' ? body.reportName : `pc-report-${Date.now()}`,
      content: typeof body.content === 'string' ? body.content : '',
      contentType: body.contentType === 'yaml' ? 'yaml' : 'text',
      preconditionText: typeof body.preconditionText === 'string' ? body.preconditionText : undefined,
      checkpoints: Array.isArray(body.checkpoints) ? body.checkpoints : (typeof body.checkPointsRaw === 'string' ? parseCheckpoints(body.checkPointsRaw) : []),
      deviceOpt: body.deviceOpt && typeof body.deviceOpt === 'object' ? body.deviceOpt : {},
    });
    const sessionId = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(sessionId, { result, reportDir: result.report_dir, createdAt: Date.now() });
    console.log(`[pc-agent] /execute → sessionId=${sessionId} status=${result.status} reportDir=${result.report_dir ?? '(none)'}`);
    res.json({ code: 200, message: 'ok', data: { sessionId, result } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pc-agent] /execute ERROR: ${msg}`);
    res.status(500).json({ code: 500, message: `execute failed: ${msg}` });
  }
});

// GET /sessions/:id/report — download the tar.gz'd report dir.
// Returns application/gzip bytes. Best-effort: if no report was written
// (crash before report), returns 404.
app.get('/sessions/:id/report', async (req, res) => {
  const sessionId = req.params.id;
  const entry = sessions.get(sessionId);
  if (!entry) {
    res.status(404).json({ code: 404, message: 'session not found' });
    return;
  }
  if (!entry.reportDir) {
    res.status(404).json({ code: 404, message: 'no report dir for this session' });
    return;
  }
  try {
    const tarball = await tarGzDir(entry.reportDir);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.tar.gz"`);
    res.send(tarball);
    console.log(`[pc-agent] /sessions/${sessionId}/report sent ${(tarball.length / 1024).toFixed(1)}KB`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pc-agent] /sessions/${sessionId}/report ERROR: ${msg}`);
    res.status(500).json({ code: 500, message: `report packaging failed: ${msg}` });
  }
});

const server = createServer(app);
server.listen(AGENT_PC_PORT, () => {
  console.log(`[${AGENT_NAME}] listening on http://0.0.0.0:${AGENT_PC_PORT} (server=${AGENT_SERVER_URL})`);
  startHeartbeatLoop({ serverUrl: AGENT_SERVER_URL, agentToken: AGENT_TOKEN, agentPort: AGENT_PC_PORT });
});

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[${AGENT_NAME}] received ${signal}, shutting down...`);
  stopHeartbeatLoop();
  try {
    await sendShutdown({ serverUrl: AGENT_SERVER_URL!, agentToken: AGENT_TOKEN!, agentPort: AGENT_PC_PORT });
  } catch (e) {
    console.log(`[${AGENT_NAME}] sendShutdown error: ${e instanceof Error ? e.message : String(e)}`);
  }
  server.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
