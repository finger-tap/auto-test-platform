// 2026-07-01: pc-agent heartbeat — self-contained. Identical protocol to
// the other agents (register / heartbeat / shutdown), but kept in-tree so
// pc-agent's bundle doesn't drag agent-web's source files along. The kind
// label is fixed to 'pc' — the central server reads it from the register
// payload and writes it into devices.kind.

import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEARTBEAT_INTERVAL_MS = 30_000;   // 30s
const REGISTER_EVERY_MS = 10 * 60_000; // re-register every 10 min

// Read this process's own version from package.json. In deployed bundles the
// manifest sits one level above pc-agent-src/; in local dev/dist it sits two
// levels above src/agent-pc or dist/agent-pc.
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
    agentKind: 'pc',
    agentEndpoint: endpoint,
    version: PKG_VERSION,
  });

  if (res.ok) {
    if (shouldRegister) {
      console.log(`[pc-agent:heartbeat] registered (status=${res.status}) endpoint=${endpoint}`);
      _lastRegisterAt = now;
    } else {
      console.log(`[pc-agent:heartbeat] ok (status=${res.status})`);
    }
  } else if (res.status === 401) {
    console.error(`[pc-agent:heartbeat] VERSION MISMATCH (401) — ${res.text}`);
    console.error(`[pc-agent:heartbeat] the central server requires a newer agent version.`);
    console.error(`[pc-agent:heartbeat] please open the platform UI → Devices → Agent → 重连/升级 to push a fresh bundle.`);
    console.error(`[pc-agent:heartbeat] exiting (1) so the service manager marks this unit failed...`);
    _stopped = true;
    setTimeout(() => process.exit(1), 200);
  } else {
    console.log(`[pc-agent:heartbeat] failed (status=${res.status} body=${res.text.slice(0, 200)})`);
  }
}

export function startHeartbeatLoop(deps: HeartbeatDeps): void {
  if (_timer) return;
  _stopped = false;
  void tick(deps);
  _timer = setInterval(() => { void tick(deps); }, HEARTBEAT_INTERVAL_MS);
  _timer.unref?.();
  console.log(`[pc-agent:heartbeat] started interval=${HEARTBEAT_INTERVAL_MS}ms server=${deps.serverUrl}`);
}

export function stopHeartbeatLoop(): void {
  _stopped = true;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log(`[pc-agent:heartbeat] stopped`);
}

export async function sendShutdown(deps: HeartbeatDeps): Promise<void> {
  const url = deps.serverUrl.replace(/\/$/, '') + '/api/agents/shutdown';
  const res = await postJson(url, deps.agentToken, {});
  console.log(`[pc-agent:heartbeat] shutdown sent (status=${res.status})`);
}
