// 2026-06-06: routes for remote browser agents.
//
// Agents are small Node services deployed on remote machines. They:
//   1. POST /api/agents/register  on startup (or first time) to tell the
//      central server where they are reachable (agentEndpoint) and what
//      version they are. Server marks the device online.
//   2. POST /api/agents/heartbeat every ~30s with the same fields. Server
//      keeps last_seen_at fresh. A periodic cron on the server flips stale
//      agents to offline.
//   3. POST /api/agents/shutdown  on graceful exit to mark offline early
//      (otherwise we wait for the cron to detect staleness).
//
// The web-executor also calls an agent directly (not through these routes)
// to launch browsers — that path is `engine/agent-client.ts` and hits the
// agent's own HTTP server (e.g. http://agent-host:4001/launch). What goes
// through THIS router is the agent's registration / heartbeat / shutdown.

import { Router, type Request, type Response } from 'express';
import { agentAuthMiddleware } from '../auth/middleware.js';
import { updateAgentHeartbeat, markAgentOffline, getRequiredAgentVersion, setNeedsUpgrade } from '../db/devices.js';

export const agentRoutes = Router();

// All routes under /api/agents use the agent-bearer auth, not human JWT.
agentRoutes.use(agentAuthMiddleware);

// POST /api/agents/register
// Body: { agentEndpoint: "http://192.168.1.50:4001", version: "0.1.0" }
// Idempotent — safe to call on every agent startup, or on re-registration
// after the agent's IP changes. Updates the device's endpoint / version
// and flips status to online.
//
// 2026-06-07: if the reported version doesn't match the server's required
// version, return 401. The agent process sees 401, prints an upgrade
// prompt, and exits. The device row is marked needs_upgrade=1 (not online)
// so the UI's "重连/升级" button is visible.
agentRoutes.post('/register', (req: Request, res: Response) => {
  const device = req.agent!.device;
  const { agentEndpoint, version } = req.body || {};
  if (typeof agentEndpoint !== 'string' || !agentEndpoint.trim()) {
    res.status(400).json({ code: 400, message: 'agentEndpoint is required' });
    return;
  }
  // Light validation: must look like a URL. We don't enforce HTTPS in dev.
  if (!/^https?:\/\//.test(agentEndpoint)) {
    res.status(400).json({ code: 400, message: 'agentEndpoint must start with http(s)://' });
    return;
  }
  const v = typeof version === 'string' ? version : 'unknown';
  const required = getRequiredAgentVersion();
  if (v !== 'unknown' && v !== required) {
    setNeedsUpgrade(device.id, true);
    console.log(`[agent-routes] version mismatch device=${device.id} got=${v} required=${required}; rejecting with 401`);
    res.status(401).json({
      code: 401,
      message: `agent version mismatch: server requires ${required}, agent has ${v}. Please run the upgrade command on the central server (Devices → Agent → 重连/升级).`,
      required_version: required,
    });
    return;
  }

  updateAgentHeartbeat(device.id, agentEndpoint.trim(), v);
  console.log(`[agent-routes] registered device=${device.id} name="${device.name}" endpoint=${agentEndpoint} version=${v}`);
  res.json({ code: 200, message: 'ok', data: { deviceId: device.id, status: 'online' } });
});

// POST /api/agents/heartbeat
// Body: { agentEndpoint?: string, version?: string } — both optional. The
// endpoint and version are only persisted if supplied, so a bare heartbeat
// (sent every 30s) can omit them to keep the payload tiny.
//
// 2026-06-07: same version check as /register. The version field is
// re-validated on every heartbeat so a deploy that ships a new server
// version immediately flips a still-running old agent to 401 — no
// waiting for the next re-registration cycle.
agentRoutes.post('/heartbeat', (req: Request, res: Response) => {
  const device = req.agent!.device;
  const { agentEndpoint, version } = req.body || {};
  const incomingVersion = typeof version === 'string' ? version : null;
  const required = getRequiredAgentVersion();
  if (incomingVersion && incomingVersion !== required) {
    setNeedsUpgrade(device.id, true);
    console.log(`[agent-routes] version mismatch on heartbeat device=${device.id} got=${incomingVersion} required=${required}; rejecting with 401`);
    res.status(401).json({
      code: 401,
      message: `agent version mismatch: server requires ${required}, agent has ${incomingVersion}. Please run the upgrade command on the central server (Devices → Agent → 重连/升级).`,
      required_version: required,
    });
    return;
  }
  // If neither field is supplied, just touch last_seen_at. We do this via
  // updateAgentHeartbeat with the existing endpoint/version to avoid a
  // second UPDATE path.
  updateAgentHeartbeat(
    device.id,
    typeof agentEndpoint === 'string' && agentEndpoint.trim() ? agentEndpoint.trim() : (device.agent_endpoint ?? ''),
    incomingVersion ?? (device.agent_version ?? 'unknown')
  );
  res.json({ code: 200, message: 'ok' });
});

// POST /api/agents/shutdown
// Body: {} (none). Agent calls this on SIGTERM / SIGINT.
agentRoutes.post('/shutdown', (req: Request, res: Response) => {
  const device = req.agent!.device;
  markAgentOffline(device.id);
  console.log(`[agent-routes] graceful shutdown device=${device.id} name="${device.name}"`);
  res.json({ code: 200, message: 'ok' });
});
