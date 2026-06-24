import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  refreshDeviceStatus,
  DeviceTestType,
  DeviceStatus,
} from '../db/devices.js';
import { encryptColumn, isPushEnabled, serializeBlob } from '../agent-push/crypto.js';
import { pushAgent, stopAgent, pushMobileAgent, stopMobileAgent, pushPcAgent, stopPcAgent } from '../agent-push/push.js';
import { listMergedMobileDevices, invalidateMergedCache } from '../devices/merge.js';
import { healthCheckAgent } from '../engine/agent-client.js';

export const deviceRoutes = Router();
deviceRoutes.use(authMiddleware);

const VALID_TEST_TYPES: DeviceTestType[] = ['web', 'pc', 'mobile'];
const VALID_STATUSES: DeviceStatus[] = ['online', 'offline', 'unknown'];
const VALID_SSH_AUTH: Array<'password' | 'private_key'> = ['password', 'private_key'];
const VALID_OS_TYPES: string[] = ['linux', 'macos'];   // linux + macos supported for push

/**
 * Encrypt SSH credentials (password / private key) before they hit SQLite.
 * Returns the JSON-stringified blob to pass to the DB layer, or null if
 * the field is empty / the server has no encryption key configured.
 */
function encryptSshField(col: 'ssh_password' | 'ssh_private_key', value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isPushEnabled()) {
    // Storing plaintext would be unacceptable; refuse the write.
    throw new Error('AGENT_SSH_KEY_SECRET not configured; cannot store SSH credentials');
  }
  const blob = encryptColumn(col, value);
  return blob ? serializeBlob(blob) : null;
}

/**
 * Strip the SSH credential columns from a device row before it leaves
 * the server. The ciphertexts are useless to the client (no decryption
 * key shipped to the browser) and would only confuse the form fields.
 *
 * Has-ssh-push-info booleans are kept so the UI can render checkmarks
 * ("已配置 / 未配置") without needing to know the ciphertext length.
 */
function scrubDevice<T extends { ssh_password: unknown; ssh_private_key: unknown }>(
  d: T
): Omit<T, 'ssh_password' | 'ssh_private_key'> & {
  has_ssh_password: boolean;
  has_ssh_private_key: boolean;
} {
  const { ssh_password, ssh_private_key, ...rest } = d;
  return {
    ...rest,
    has_ssh_password: !!ssh_password,
    has_ssh_private_key: !!ssh_private_key,
  };
}

// GET /api/devices
deviceRoutes.get('/', async (req: Request, res: Response) => {
  const testType = req.query.test_type as string | undefined;
  const status = req.query.status as string | undefined;
  const keyword = req.query.keyword as string | undefined;

  if (testType && !VALID_TEST_TYPES.includes(testType as DeviceTestType)) {
    res.status(400).json({ code: 400, message: `Invalid test_type: ${testType}` });
    return;
  }
  if (status && !VALID_STATUSES.includes(status as DeviceStatus)) {
    res.status(400).json({ code: 400, message: `Invalid status: ${status}` });
    return;
  }

  const items = listDevices(req.user!.userId, {
    test_type: testType as DeviceTestType | undefined,
    status: status as DeviceStatus | undefined,
    keyword: keyword || undefined,
  });

  // 2026-06-20: 批量查 busy 状态（web/pc/mobile 三种执行表）
  const deviceIds = items.map(d => d.id);
  let busySet = new Set<number>();
  if (deviceIds.length > 0) {
    try {
      const { findRunningWebExecutionsByDeviceIds } = await import('../db/web-cases.js');
      const { findRunningPcExecutionsByDeviceIds } = await import('../db/pc-cases.js');
      const { findRunningExecutionsByDeviceIds } = await import('../db/mobile-tests.js');
      const webBusy = findRunningWebExecutionsByDeviceIds(deviceIds);
      const pcBusy = findRunningPcExecutionsByDeviceIds(deviceIds);
      const mobileBusy = findRunningExecutionsByDeviceIds(deviceIds);
      for (const id of deviceIds) {
        if (webBusy.has(id) || pcBusy.has(id) || mobileBusy.has(id)) busySet.add(id);
      }
    } catch (e) {
      console.log(`[routes:devices] busy lookup failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  res.json({
    code: 200, message: 'ok',
    data: { items: items.map(d => ({ ...scrubDevice(d), busy: busySet.has(d.id) })) },
  });
});

// Returns a single list combining locally-enumerated devices (adb/hdc/idevice)
// with the user's remote mobile-agent-reported rows from the devices table.
// Front-end uses this directly to render the device picker modal for
// mobile-test execution. Cached 30s server-side; UI can force refresh with
// POST /api/devices/merged/refresh?test_type=mobile.
//
// NOTE: 2026-06-09 这些路由必须注册在 /:id 之前,否则 Express 会把 "merged"
// 当成 :id 参数 → 400 "Invalid id"(已经在 user 那边复现)。/merged/refresh 同理
// 会被 /:id/refresh 吞掉。

/**
 * GET /api/devices/merged?test_type=mobile
 * Body: (none) — query param `test_type` is required and currently only
 * `mobile` is supported (web/pc don't need merging — they're either
 * local or remote, not both).
 */
deviceRoutes.get('/merged', async (req: Request, res: Response) => {
  const testType = (req.query.test_type as string) || '';
  if (!['mobile', 'web', 'pc'].includes(testType)) {
    res.status(400).json({ code: 400, message: `Invalid test_type for /merged: ${testType || '∅'}` });
    return;
  }
  try {
    if (testType === 'mobile') {
      const items = await listMergedMobileDevices(req.user!.userId);
      res.json({ code: 200, message: 'ok', data: { items } });
      return;
    }
    // web / pc: 不需要 local+remote 合并，直接从 devices 表查 + 计算 busy
    const items = listDevices(req.user!.userId, { test_type: testType as DeviceTestType });
    const deviceIds = items.map(d => d.id);
    let busySet = new Set<number>();
    if (deviceIds.length > 0) {
      if (testType === 'web') {
        const { findRunningWebExecutionsByDeviceIds } = await import('../db/web-cases.js');
        const m = findRunningWebExecutionsByDeviceIds(deviceIds);
        for (const id of deviceIds) if (m.has(id)) busySet.add(id);
      } else {
        const { findRunningPcExecutionsByDeviceIds } = await import('../db/pc-cases.js');
        const m = findRunningPcExecutionsByDeviceIds(deviceIds);
        for (const id of deviceIds) if (m.has(id)) busySet.add(id);
      }
    }
    const enriched = items.map(d => ({
      ...scrubDevice(d),
      busy: busySet.has(d.id),
      source: 'remote' as const,
    }));
    res.json({ code: 200, message: 'ok', data: { items: enriched } });
  } catch (e) {
    res.status(500).json({
      code: 500,
      message: `Failed to enumerate devices: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
});

/**
 * POST /api/devices/merged/refresh?test_type=mobile|web|pc
 * Body: (none) — invalidates the in-process cache for this user so the next
 * GET re-enumerates. For web/pc this is a no-op (no cache), but the frontend
 * can call it uniformly.
 */
deviceRoutes.post('/merged/refresh', (req: Request, res: Response) => {
  const testType = (req.query.test_type as string) || '';
  if (!['mobile', 'web', 'pc'].includes(testType)) {
    res.status(400).json({ code: 400, message: `Invalid test_type: ${testType || '∅'}` });
    return;
  }
  if (testType === 'mobile') {
    invalidateMergedCache(req.user!.userId);
  }
  res.json({ code: 200, message: 'Cache invalidated' });
});

// GET /api/devices/:id
deviceRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: scrubDevice(device) });
});

// POST /api/devices
deviceRoutes.post('/', (req: Request, res: Response) => {
  const { name, test_type, platform, serial, host, status, metadata, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }
  if (!VALID_TEST_TYPES.includes(test_type)) {
    res.status(400).json({ code: 400, message: `Invalid test_type: ${test_type}` });
    return;
  }
  if (!platform || typeof platform !== 'string' || !platform.trim()) {
    res.status(400).json({ code: 400, message: 'Platform is required' });
    return;
  }
  if (status && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ code: 400, message: `Invalid status: ${status}` });
    return;
  }
  // 2026-06-07: optional SSH fields at create time. Validation mirrors
  // PUT below — non-Linux os_type is rejected only if user opts in to
  // push, which the create handler can't tell, so we accept any string
  // and let the push endpoint refuse.
  if (ssh_auth_type !== undefined && !VALID_SSH_AUTH.includes(ssh_auth_type)) {
    res.status(400).json({ code: 400, message: `Invalid ssh_auth_type: ${ssh_auth_type}` });
    return;
  }
  if (os_type !== undefined && !VALID_OS_TYPES.includes(os_type)) {
    res.status(400).json({ code: 400, message: `OS "${os_type}" is not supported (only ${VALID_OS_TYPES.join(', ')})` });
    return;
  }

  let encPassword: string | null = null;
  let encKey: string | null = null;
  try {
    encPassword = encryptSshField('ssh_password', ssh_password);
    encKey = encryptSshField('ssh_private_key', ssh_private_key);
  } catch (e) {
    res.status(503).json({ code: 503, message: e instanceof Error ? e.message : String(e) });
    return;
  }

  const id = createDevice(req.user!.userId, {
    name: name.trim(),
    test_type: test_type as DeviceTestType,
    platform: platform.trim(),
    serial: serial || undefined,
    host: host || undefined,
    status: (status as DeviceStatus) || 'unknown',
    metadata: metadata || undefined,
    ssh_host: ssh_host || undefined,
    ssh_port: typeof ssh_port === 'number' ? ssh_port : (ssh_port ? Number(ssh_port) : 22),
    ssh_user: ssh_user || undefined,
    ssh_auth_type: ssh_auth_type || undefined,
    ssh_password: encPassword || undefined,
    ssh_private_key: encKey || undefined,
    os_type: os_type || undefined,
  });
  // 2026-06-06: return the agent_token in the create response so the user
  // can copy it once and paste into the agent's AGENT_TOKEN env var. The
  // token is also available later via GET /api/devices/:id/agent-info.
  const created = getDevice(id);
  res.status(201).json({
    code: 201,
    message: 'Created',
    data: {
      id,
      agent_token: created?.agent_token ?? null,
    },
  });
});

// PUT /api/devices/:id
deviceRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }

  const { name, platform, serial, host, status, metadata, agent_endpoint, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = req.body;
  if (status && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ code: 400, message: `Invalid status: ${status}` });
    return;
  }
  if (agent_endpoint !== undefined && agent_endpoint !== null && typeof agent_endpoint !== 'string') {
    res.status(400).json({ code: 400, message: 'agent_endpoint must be a string' });
    return;
  }
  if (typeof agent_endpoint === 'string' && agent_endpoint && !/^https?:\/\//.test(agent_endpoint)) {
    res.status(400).json({ code: 400, message: 'agent_endpoint must start with http(s)://' });
    return;
  }
  if (ssh_auth_type !== undefined && ssh_auth_type !== null && !VALID_SSH_AUTH.includes(ssh_auth_type)) {
    res.status(400).json({ code: 400, message: `Invalid ssh_auth_type: ${ssh_auth_type}` });
    return;
  }
  if (os_type !== undefined && os_type !== null && !VALID_OS_TYPES.includes(os_type)) {
    res.status(400).json({ code: 400, message: `OS "${os_type}" is not supported (only ${VALID_OS_TYPES.join(', ')})` });
    return;
  }
  if (ssh_port !== undefined && ssh_port !== null && (typeof ssh_port !== 'number' || ssh_port < 1 || ssh_port > 65535)) {
    res.status(400).json({ code: 400, message: 'ssh_port must be a number 1-65535' });
    return;
  }

  // SSH credentials: encrypt before saving. The UI sends plaintext once;
  // we hash it and only return ciphertext afterward (the GET /:id response
  // does NOT include ssh_password / ssh_private_key, see privacy filter
  // below).
  let encPassword: string | null | undefined = undefined;  // undefined = no change
  let encKey: string | null | undefined = undefined;
  try {
    if (ssh_password === null) encPassword = null;        // explicit clear
    else if (typeof ssh_password === 'string' && ssh_password) {
      const blob = encryptColumn('ssh_password', ssh_password);
      encPassword = blob ? serializeBlob(blob) : null;
    }
    if (ssh_private_key === null) encKey = null;
    else if (typeof ssh_private_key === 'string' && ssh_private_key) {
      const blob = encryptColumn('ssh_private_key', ssh_private_key);
      encKey = blob ? serializeBlob(blob) : null;
    }
  } catch (e) {
    res.status(503).json({ code: 503, message: e instanceof Error ? e.message : String(e) });
    return;
  }

  const changes = updateDevice(id, {
    name: name ?? undefined,
    platform: platform ?? undefined,
    serial: serial ?? undefined,
    host: host ?? undefined,
    status: status as DeviceStatus | undefined,
    metadata: metadata ?? undefined,
    agent_endpoint: agent_endpoint ?? undefined,
    // null = clear (UI's "clear" button), undefined = don't touch.
    // Empty string is treated as undefined so the form can be sent
    // without populating optional fields.
    ssh_host: ssh_host === '' ? undefined : (ssh_host ?? undefined),
    ssh_port: ssh_port === null ? null : (typeof ssh_port === 'number' ? ssh_port : (ssh_port ? Number(ssh_port) : undefined)),
    ssh_user: ssh_user === '' ? undefined : (ssh_user ?? undefined),
    ssh_auth_type: ssh_auth_type === '' ? undefined : (ssh_auth_type ?? undefined),
    ssh_password: encPassword,
    ssh_private_key: encKey,
    os_type: os_type === '' ? undefined : (os_type ?? undefined),
  });
  res.json({ code: 200, message: 'Updated', data: { changes } });
});

// DELETE /api/devices/:id
deviceRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  const changes = deleteDevice(id);
  res.json({ code: 200, message: 'Deleted', data: { changes } });
});

// 2026-06-06: owner-only view of the agent_token + endpoint + heartbeat.
// The token is needed by the agent process via env var — exposing it here
// means the user can recover it from the UI (e.g. after closing the
// create-success toast) without re-creating the device.
deviceRoutes.get('/:id/agent-info', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  res.json({
    code: 200,
    message: 'ok',
    data: {
      id: device.id,
      name: device.name,
      test_type: device.test_type,
      platform: device.platform,
      status: device.status,
      agent_token: device.agent_token,
      agent_endpoint: device.agent_endpoint,
      agent_version: device.agent_version,
      last_seen_at: device.last_seen_at,
      needs_upgrade: device.needs_upgrade,
      // Non-secret SSH fields — the modal's push/stop buttons need these
      // to gate visibility. Passwords and private keys are scrubbed and
      // exposed only as `has_*` booleans (decrypt happens server-side).
      ssh_host: device.ssh_host,
      ssh_port: device.ssh_port,
      ssh_user: device.ssh_user,
      ssh_auth_type: device.ssh_auth_type,
      os_type: device.os_type,
      // SSH push state — the UI shows this in the modal so the user can
      // tell whether the last push succeeded and what the error was.
      last_push_at: device.last_push_at,
      last_push_status: device.last_push_status,
      last_push_error: device.last_push_error,
      has_ssh_password: !!device.ssh_password,
      has_ssh_private_key: !!device.ssh_private_key,
      // Convenience: pre-rendered one-line command to launch the agent
      // against this device. Useful for the "复制部署命令" button in UI.
      deploy_command: device.agent_token
        ? `AGENT_TOKEN=${device.agent_token} AGENT_SERVER_URL=${process.env.PUBLIC_SERVER_URL || 'http://localhost:3000'} npm run agent`
        : null,
    },
  });
});

// POST /api/devices/:id/refresh —— 手动刷新状态（无执行器时也允许手动置为 online/offline）
deviceRoutes.post('/:id/refresh', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  const status = (req.body?.status as DeviceStatus) || 'unknown';
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ code: 400, message: `Invalid status: ${status}` });
    return;
  }
  const changes = refreshDeviceStatus(id, status);
  res.json({ code: 200, message: 'Refreshed', data: { changes } });
});

// ── SSH push / stop endpoints (2026-06-07) ──

/**
 * Async owner check helper — shared by both push and stop endpoints.
 * Returns the device row (or sends the error response and returns null).
 */
function requireOwnedDevice(req: Request, res: Response): ReturnType<typeof getDevice> {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return undefined;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return undefined;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return undefined;
  }
  return device;
}

/**
 * POST /api/devices/:id/push-agent
 * Body: (none) — uses the ssh_* fields saved on the device row.
 *
 * Synchronously runs the SSH push (bundle, upload, deploy). Can take
 * 1-2 minutes. We do NOT background the work because the UI's button
 * is gated on a clear loading state and showing the result in a toast
 * is the cleanest UX. If push times out, the device row is still
 * updated with `last_push_status='error'`.
 */
deviceRoutes.post('/:id/push-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'web') {
    res.status(400).json({ code: 400, message: 'Only web devices support SSH push' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  const result = await pushAgent(device);
  if (!result.ok) {
    res.status(500).json({
      code: 500,
      message: result.error || 'push failed',
      data: result,
    });
    return;
  }
  res.json({
    code: 200,
    message: 'Agent pushed and restarted',
    data: result,
  });
});

/**
 * POST /api/devices/:id/stop-agent
 * Body: (none) — SSHes in and runs `systemctl stop auto-test-agent`.
 * The agent sends /shutdown on SIGTERM, so the device row flips to
 * offline within a few seconds.
 */
deviceRoutes.post('/:id/stop-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'web') {
    res.status(400).json({ code: 400, message: 'Only web devices support stop' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({ code: 503, message: 'Server has no AGENT_SSH_KEY_SECRET configured' });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }
  const result = await stopAgent(device);
  if (!result.ok) {
    res.status(500).json({ code: 500, message: result.error || 'stop failed' });
    return;
  }
  res.json({ code: 200, message: 'Agent stopped' });
});

/**
 * POST /api/devices/:id/push-mobile-agent
 * 2026-06-08: 跟 push-agent 平行,推 mobile-agent bundle 到 mobile 设备。
 * systemd unit 名是 auto-test-mobile-agent.service,入口是
 * mobile-agent-src/index.js,听 4002 端口。
 */
deviceRoutes.post('/:id/push-mobile-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'mobile') {
    res.status(400).json({ code: 400, message: 'Only mobile devices support push-mobile-agent' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  const result = await pushMobileAgent(device);
  if (!result.ok) {
    res.status(500).json({
      code: 500,
      message: result.error || 'push-mobile-agent failed',
      data: result,
    });
    return;
  }
  res.json({
    code: 200,
    message: 'Mobile agent pushed and restarted',
    data: result,
  });
});

/**
 * POST /api/devices/:id/stop-mobile-agent
 * 2026-06-08: 跟 stop-agent 平行,停 auto-test-mobile-agent.service。
 */
deviceRoutes.post('/:id/stop-mobile-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'mobile') {
    res.status(400).json({ code: 400, message: 'Only mobile devices support stop-mobile-agent' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({ code: 503, message: 'Server has no AGENT_SSH_KEY_SECRET configured' });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }
  const result = await stopMobileAgent(device);
  if (!result.ok) {
    res.status(500).json({ code: 500, message: result.error || 'stop-mobile-agent failed' });
    return;
  }
  res.json({ code: 200, message: 'Mobile agent stopped' });
});

/**
 * POST /api/devices/:id/push-pc-agent
 * 2026-06-15: 跟 push-agent/push-mobile-agent 平行,推 pc-agent bundle 到 PC 设备。
 * systemd unit 名是 auto-test-pc-agent.service,入口是 pc-agent-src/index.js,
 * 听 4003 端口。pc-agent 使用 @midscene/computer 驱动原生桌面。
 */
deviceRoutes.post('/:id/push-pc-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'pc') {
    res.status(400).json({ code: 400, message: 'Only PC devices support push-pc-agent' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  const result = await pushPcAgent(device);
  if (!result.ok) {
    res.status(500).json({
      code: 500,
      message: result.error || 'push-pc-agent failed',
      data: result,
    });
    return;
  }
  res.json({
    code: 200,
    message: 'PC agent pushed and restarted',
    data: result,
  });
});

/**
 * POST /api/devices/:id/stop-pc-agent
 * 2026-06-15: 跟 stop-agent/stop-mobile-agent 平行,停 auto-test-pc-agent.service。
 */
deviceRoutes.post('/:id/stop-pc-agent', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'pc') {
    res.status(400).json({ code: 400, message: 'Only PC devices support stop-pc-agent' });
    return;
  }
  if (!isPushEnabled()) {
    res.status(503).json({ code: 503, message: 'Server has no AGENT_SSH_KEY_SECRET configured' });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }
  const result = await stopPcAgent(device);
  if (!result.ok) {
    res.status(500).json({ code: 500, message: result.error || 'stop-pc-agent failed' });
    return;
  }
  res.json({ code: 200, message: 'PC agent stopped' });
});

// ── Agent health check (2026-06-20) ──
// GET /api/devices/:id/health — ping the agent's /healthz endpoint and
// return { ok, version, latency_ms } or { ok: false, error }.
// Used by the frontend DevicePicker to show real-time agent reachability.
deviceRoutes.get('/:id/health', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return;
  }
  const device = getDevice(id);
  if (!device) {
    res.status(404).json({ code: 404, message: 'Device not found' });
    return;
  }
  if (device.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  if (!device.agent_endpoint) {
    res.json({ code: 200, message: 'ok', data: { ok: false, error: 'Agent endpoint not configured' } });
    return;
  }
  const start = Date.now();
  try {
    const result = await healthCheckAgent(device.agent_endpoint);
    const latency = Date.now() - start;
    res.json({
      code: 200,
      message: 'ok',
      data: { ok: result.ok, version: result.version ?? null, latency_ms: latency },
    });
  } catch (e) {
    res.json({
      code: 200,
      message: 'ok',
      data: { ok: false, error: e instanceof Error ? e.message : 'Connection failed' },
    });
  }
});

// ── Merged device list (2026-06-08) ──
//
