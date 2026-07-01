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
import { updateAgentHeartbeat, markAgentOffline, getRequiredAgentVersion, setNeedsUpgrade, updateAgentDeviceMetadata } from '../db/devices.js';
import { resolveMidsceneEnvMapForUser, getAgentOptOverrides } from '../engine/midscene-config.js';

export const agentRoutes = Router();

// All routes under /api/agents use the agent-bearer auth, not human JWT.
agentRoutes.use(agentAuthMiddleware);

/**
 * 2026-06-08: 解析并校验请求体里的 agent_kind。
 * - 'web' / 'mobile' / 'pc' → 接受
 * - 缺失                  → 默认 'web'(旧版 web-agent 不发这个字段,保持兼容)
 * - 其它值                → 拒
 *
 * 然后跟 device.test_type 对一下:web 设备只能跑 web-agent,mobile 设备只能跑
 * mobile-agent,pc 设备只能跑 pc-agent。如果不一致返回 400,让 agent 进程退出
 * — 这是配置错乱(用户把 web-agent 推到了 mobile 设备上),重来比修好。
 */
function parseAgentKind(raw: unknown, device: { test_type?: string | null }): { kind: 'web' | 'mobile' | 'pc' } | { error: string } {
  let kind: 'web' | 'mobile' | 'pc' = 'web';
  if (typeof raw === 'string' && raw.length > 0) {
    if (raw !== 'web' && raw !== 'mobile' && raw !== 'pc') return { error: `agent_kind must be 'web', 'mobile' or 'pc', got ${raw}` };
    kind = raw;
  }
  const deviceType = device.test_type ?? 'web';
  if (deviceType !== 'web' && deviceType !== 'mobile' && deviceType !== 'pc') return { error: `device.test_type=${deviceType} is not a known agent kind` };
  if (kind !== deviceType) return { error: `agent_kind=${kind} does not match device.test_type=${deviceType}` };
  return { kind };
}

// POST /api/agents/register
// Body: { agentEndpoint: "http://192.168.1.50:4001", version: "0.1.0", agentKind?: "web"|"mobile"|"pc" }
// Idempotent — safe to call on every agent startup, or on re-registration
// after the agent's IP changes. Updates the device's endpoint / version
// and flips status to online.
//
// 2026-06-07: if the reported version doesn't match the server's required
// version, return 401. The agent process sees 401, prints an upgrade
// prompt, and exits. The device row is marked needs_upgrade=1 (not online)
// so the UI's "重连/升级" button is visible.
//
// 2026-06-08: 加 agent_kind 校验(见 parseAgentKind 上面)。
agentRoutes.post('/register', (req: Request, res: Response) => {
  const device = req.agent!.device;
  const { agentEndpoint, version, agentKind } = req.body || {};
  if (typeof agentEndpoint !== 'string' || !agentEndpoint.trim()) {
    res.status(400).json({ code: 400, message: 'agentEndpoint is required' });
    return;
  }
  // Light validation: must look like a URL. We don't enforce HTTPS in dev.
  if (!/^https?:\/\//.test(agentEndpoint)) {
    res.status(400).json({ code: 400, message: 'agentEndpoint must start with http(s)://' });
    return;
  }
  const kindResult = parseAgentKind(agentKind, device);
  if ('error' in kindResult) {
    res.status(400).json({ code: 400, message: kindResult.error });
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
  console.log(`[agent-routes] registered device=${device.id} name="${device.name}" kind=${kindResult.kind} endpoint=${agentEndpoint} version=${v}`);
  // 2026-06-09: 注册成功后 fire-and-forget 拉一次本机设备列表(仅 mobile),
  // 写到 devices.metadata,给 merge.ts 读。失败不阻塞 register。
  if (device.test_type === 'mobile') {
    void fetchAndPersistDeviceList(device.id, device.agent_token, agentEndpoint.trim());
  }
  res.json({ code: 200, message: 'ok', data: { deviceId: device.id, status: 'online' } });
});

// POST /api/agents/heartbeat
// Body: { agentEndpoint?: string, version?: string, agentKind?: "web"|"mobile"|"pc" } — both optional. The
// endpoint and version are only persisted if supplied, so a bare heartbeat
// (sent every 30s) can omit them to keep the payload tiny.
//
// 2026-06-07: same version check as /register. The version field is
// re-validated on every heartbeat so a deploy that ships a new server
// version immediately flips a still-running old agent to 401 — no
// waiting for the next re-registration cycle.
agentRoutes.post('/heartbeat', (req: Request, res: Response) => {
  const device = req.agent!.device;
  const { agentEndpoint, version, agentKind } = req.body || {};
  const kindResult = parseAgentKind(agentKind, device);
  if ('error' in kindResult) {
    res.status(400).json({ code: 400, message: kindResult.error });
    return;
  }
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
  // 2026-06-09: heartbeat 同样拉一次设备列表(仅 mobile),30s 一次,
  // 30s 缓存窗口刚好覆盖。失败不阻塞 heartbeat。
  if (device.test_type === 'mobile' && device.agent_token && device.agent_endpoint) {
    void fetchAndPersistDeviceList(device.id, device.agent_token, device.agent_endpoint);
  }
  res.json({ code: 200, message: 'ok' });
});

// POST /api/agents/midscene-config
// Body: { userId?: number }
// Returns the executor user's resolved Midscene config for remote agents.
// User DB config wins; blank fields fall back to the central server's project
// default MIDSCENE_* env. The remote agent calls this through AGENT_SERVER_URL
// so it does not need model secrets baked into the deployed bundle or plist.
agentRoutes.post('/midscene-config', (req: Request, res: Response) => {
  const device = req.agent!.device;
  const requestedUserId = Number(req.body?.userId);
  const userId = Number.isFinite(requestedUserId) && requestedUserId > 0
    ? requestedUserId
    : device.user_id;
  const env = resolveMidsceneEnvMapForUser(userId);
  const agentOpt = getAgentOptOverrides(userId);
  const maskedKeys = Object.keys(env).map(k => k.includes('API_KEY') ? `${k}=****` : k);
  console.log(`[agent-routes] midscene-config device=${device.id} executor=${userId} keys=${maskedKeys.join(',') || '(none)'}`);
  res.json({ code: 200, message: 'ok', data: { userId, env, agentOpt } });
});

// POST /api/agents/shutdown
// Body: {} (none). Agent calls this on SIGTERM / SIGINT.
agentRoutes.post('/shutdown', (req: Request, res: Response) => {
  const device = req.agent!.device;
  markAgentOffline(device.id);
  console.log(`[agent-routes] graceful shutdown device=${device.id} name="${device.name}"`);
  res.json({ code: 200, message: 'ok' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-06-09: mobile-agent 设备列表拉取
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget:拉 agent 端的 POST /devices,持久化到 devices.metadata。
 * - 4s 超时 — agent 偶尔 hang 也不能拖住 server
 * - 失败/超时/非 200 → log 但不 throw,caller 拿不到错误(也不关心)
 * - 返回的 items 是 MobileDeviceRow[];server 端 merge.ts 读 metadata 解析成
 *   RichInfo,跟本地 adb/hdc 信息合并
 */
async function fetchAndPersistDeviceList(
  deviceId: number,
  agentToken: string | null,
  agentEndpoint: string
): Promise<void> {
  if (!agentToken) return;
  const url = `${agentEndpoint.replace(/\/$/, '')}/devices`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) {
      // 404 是老 agent 没这个端点,正常;其它状态码也 log 但不抛
      console.log(`[agent-routes] /devices fetch from ${url} returned ${res.status}`);
      return;
    }
    const json = await res.json() as { data?: { items?: unknown[] } };
    const items = Array.isArray(json?.data?.items) ? json!.data!.items : [];
    if (items.length === 0) return;
    updateAgentDeviceMetadata(deviceId, items);
    console.log(`[agent-routes] persisted ${items.length} device(s) from agent=${url} to device=${deviceId}`);
  } catch (e) {
    console.log(`[agent-routes] /devices fetch from ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
