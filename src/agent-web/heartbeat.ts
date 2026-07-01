// 2026-06-06: agent heartbeat loop.
//
// Periodically POST /api/agents/heartbeat to the central server so the
// device row's last_seen_at stays fresh. The central server's scheduler
// cron marks devices offline when last_seen_at is older than 90s.
//
// Two endpoints involved in registration lifecycle:
//   - POST /api/agents/register  — sent on startup, also on every Xth
//     heartbeat (every 10 min) so re-registration happens automatically
//     when the agent's IP changes. Not just once, because the central
//     server may be redeployed with cleared state.
//   - POST /api/agents/heartbeat — sent every 30s, lightweight, just
//     touches last_seen_at. Optional agentEndpoint/version are echoed
//     back so the server's most-recent view is always fresh.
//
// 2026-06-07: a 401 from the central server with `code: 401` and a
// version-mismatch message means the server's package.json version is
// newer than ours. Print the upgrade prompt and exit(1) — systemd will
// mark the unit failed, and the user must click "重连/升级" in the UI
// to push a fresh bundle.

import os from 'node:os';

const HEARTBEAT_INTERVAL_MS = 30_000;   // 30s
const REGISTER_EVERY_MS = 10 * 60_000; // re-register every 10 min

// Read this process's own version from package.json. In deployed bundles the
// manifest sits one level above agent-src/; in local dev/dist it sits two
// levels above src/agent-web or dist/agent-web.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_VERSION = (() => {
  const req = createRequire(import.meta.url);
  for (const candidate of ['../package.json', '../../package.json', '../../../package.json']) {
    try {
      const pkg = req(path.resolve(__dirname, candidate)) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return 'unknown';
})();

let _lastRegisterAt = 0;
let _timer: NodeJS.Timeout | null = null;
let _stopped = false;

export interface HeartbeatDeps {
  serverUrl: string;
  agentToken: string;
  agentPort: number;
}

/**
 * Detect the first non-internal IPv4 address. Falls back to 127.0.0.1.
 * Override with AGENT_HOST env var if auto-detection doesn't fit (e.g. NAT).
 */
function detectHost(): string {
  const override = process.env.AGENT_HOST;
  if (override) return override;
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const e of entries) {
      if (e.family === 'IPv4' && !e.internal) return e.address;
    }
  }
  return '127.0.0.1';
}

function buildEndpoint(deps: HeartbeatDeps): string {
  return `http://${detectHost()}:${deps.agentPort}`;
}

async function postJson(url: string, token: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

async function tick(deps: HeartbeatDeps): Promise<void> {
  if (_stopped) return;
  const now = Date.now();
  const endpoint = buildEndpoint(deps);
  const shouldRegister = now - _lastRegisterAt > REGISTER_EVERY_MS;
  const path = shouldRegister ? '/api/agents/register' : '/api/agents/heartbeat';
  const url = deps.serverUrl.replace(/\/$/, '') + path;

  const res = await postJson(url, deps.agentToken, {
    agentKind: 'web',
    agentEndpoint: endpoint,
    version: PKG_VERSION,
  });

  if (res.ok) {
    if (shouldRegister) {
      console.log(`[agent:heartbeat] registered (status=${res.status}) endpoint=${endpoint}`);
      _lastRegisterAt = now;
    } else {
      console.log(`[agent:heartbeat] ok (status=${res.status})`);
    }
  } else if (res.status === 401) {
    // 2026-06-07: version mismatch from the central server. Print a loud
    // upgrade prompt and exit. systemd will mark the unit failed; the
    // user clicks "重连/升级" in the UI to push a fresh bundle.
    console.error(`[agent:heartbeat] VERSION MISMATCH (401) — ${res.text}`);
    console.error(`[agent:heartbeat] the central server requires a newer agent version.`);
    console.error(`[agent:heartbeat] please open the platform UI → Devices → Agent → 重连/升级 to push a fresh bundle.`);
    console.error(`[agent:heartbeat] exiting (1) so systemd marks this unit failed...`);
    _stopped = true;
    // Give the log line a moment to flush, then exit.
    setTimeout(() => process.exit(1), 200);
  } else {
    console.log(`[agent:heartbeat] failed (status=${res.status} body=${res.text.slice(0, 200)})`);
  }
}

export function startHeartbeatLoop(deps: HeartbeatDeps): void {
  if (_timer) return;
  _stopped = false;
  // First tick immediately (registers), then on the interval.
  void tick(deps);
  _timer = setInterval(() => { void tick(deps); }, HEARTBEAT_INTERVAL_MS);
  _timer.unref?.();
  console.log(`[agent:heartbeat] started interval=${HEARTBEAT_INTERVAL_MS}ms server=${deps.serverUrl}`);
}

export function stopHeartbeatLoop(): void {
  _stopped = true;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log(`[agent:heartbeat] stopped`);
}

/**
 * Send a one-shot /api/agents/shutdown. Called on SIGTERM/SIGINT so the
 * server marks the device offline immediately, instead of waiting for the
 * 90s stale threshold.
 */
export async function sendShutdown(deps: HeartbeatDeps): Promise<void> {
  const url = deps.serverUrl.replace(/\/$/, '') + '/api/agents/shutdown';
  const res = await postJson(url, deps.agentToken, {});
  console.log(`[agent:heartbeat] shutdown sent (status=${res.status})`);
}
