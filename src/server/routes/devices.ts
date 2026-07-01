import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  listDevices,
  getDevice,
  findDeviceByName,
  createDevice,
  updateDevice,
  deleteDevice,
  refreshDeviceStatus,
  markAgentOffline,
  recordPushResult,
  DeviceTestType,
  DeviceStatus,
  type DeviceRow,
} from '../db/devices.js';
import { encryptColumn, decryptColumn, isPushEnabled, serializeBlob } from '../agent-push/crypto.js';
import { pushAgent, stopAgent, pushMobileAgent, stopMobileAgent, pushPcAgent, stopPcAgent, serverUrlForDevice } from '../agent-push/push.js';
import type { PushProgressEvent } from '../agent-push/push.js';
import { connectSsh } from '../agent-push/ssh-client.js';
import { listMergedMobileDevices, listLocalMobileDevices, invalidateMergedCache } from '../devices/merge.js';
import { healthCheckAgent, fetchMobileDevicesFromAgent } from '../engine/agent-client.js';

export const deviceRoutes = Router();
deviceRoutes.use(authMiddleware);

const VALID_TEST_TYPES: DeviceTestType[] = ['web', 'pc', 'mobile'];
const VALID_STATUSES: DeviceStatus[] = ['online', 'offline', 'unknown'];
const VALID_SSH_AUTH: Array<'password' | 'private_key'> = ['password', 'private_key'];
const VALID_OS_TYPES: string[] = ['linux', 'macos', 'windows'];   // OS supported for remote agent push

interface PushProgressState extends PushProgressEvent {
  device_id: number;
  active: boolean;
  updated_at: string;
}

const pushProgressByDevice = new Map<number, PushProgressState>();

function setPushProgress(deviceId: number, event: PushProgressEvent, active = true): void {
  pushProgressByDevice.set(deviceId, {
    ...event,
    device_id: deviceId,
    active,
    updated_at: new Date().toISOString(),
  });
}

function pushErrorResponse(res: Response, deviceId: number, context: string, err: unknown): void {
  const message = err instanceof Error && err.message ? err.message : String(err || `${context} failed`);
  console.error(`[devices:${context}] failed device=${deviceId}: ${message}`);
  recordPushResult(deviceId, 'error', message);
  setPushProgress(deviceId, { stage: 'error', message }, false);
  res.status(500).json({
    code: 500,
    message,
    data: { ok: false, error: message },
  });
}

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
    // web / pc: 不需要 local+remote 合并，但只有 agent 真正上报过
    // agent_endpoint/agent_token 且当前在线的设备才可作为远程执行目标。
    // 仅手动把设备状态设为 online 不能代表 agent 已可调度。
    const items = listDevices(req.user!.userId, { test_type: testType as DeviceTestType })
      .filter(d => d.status === 'online' && !!d.agent_endpoint && !!d.agent_token);
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

// GET /api/devices/local-mobile-devices — 扫描本机 USB 连接的手机
// 供 DevicePickerModal 点击「本机」后获取手机列表，不查远程 agent
deviceRoutes.get('/local-mobile-devices', async (_req: Request, res: Response) => {
  try {
    const devices = await listLocalMobileDevices();
    res.json({ code: 200, message: 'ok', data: devices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to scan local devices';
    console.error(`[routes:devices] local-mobile-devices failed: ${msg}`);
    res.status(500).json({ code: 500, message: msg });
  }
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

  const trimmedName = name.trim();
  if (findDeviceByName(req.user!.userId, trimmedName)) {
    res.status(409).json({ code: 409, message: '已存在同名设备' });
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
    name: trimmedName,
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

  const { name, test_type, platform, serial, host, status, metadata, agent_endpoint, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = req.body;
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
  if (test_type !== undefined && test_type !== null && !VALID_TEST_TYPES.includes(test_type)) {
    res.status(400).json({ code: 400, message: `Invalid test_type: ${test_type}` });
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
      encPassword = encryptSshField('ssh_password', ssh_password);
    }
    if (ssh_private_key === null) encKey = null;
    else if (typeof ssh_private_key === 'string' && ssh_private_key) {
      encKey = encryptSshField('ssh_private_key', ssh_private_key);
    }
  } catch (e) {
    res.status(503).json({ code: 503, message: e instanceof Error ? e.message : String(e) });
    return;
  }

  const checkName = name && typeof name === 'string' ? name.trim() : device.name;
  const existingDevice = findDeviceByName(req.user!.userId, checkName);
  if (existingDevice && existingDevice.id !== device.id) {
    res.status(409).json({ code: 409, message: '已存在同名设备' });
    return;
  }

  const changes = updateDevice(id, {
    name: name ?? undefined,
    test_type: test_type as DeviceTestType | undefined,
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
      deploy_command: device.agent_token && serverUrlForDevice(device)
        ? `AGENT_TOKEN=${device.agent_token} AGENT_SERVER_URL=${serverUrlForDevice(device)} npm run agent`
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

deviceRoutes.get('/:id/push-progress', (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  res.json({
    code: 200,
    message: 'ok',
    data: pushProgressByDevice.get(device.id) ?? null,
  });
});

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
/**
 * 2026-07-01: 合并 test-ssh endpoint 的 fallback 逻辑。前端总是把表单所有字段塞进 body
 * + editing 时带 device_id。后端字段缺省策略:
 *   - ssh_host / ssh_user / ssh_auth_type: body 缺省 → fallback DB;再缺省 → 400
 *   - ssh_password / ssh_private_key:     body 缺省 → fallback DB(仅当 device.ssh_auth_type
 *                                          与 body auth_type 一致,否则表示 user 改了 auth_type,要求重输)
 *   - 没 device_id + 缺省密码 → 400 让 user 在 new 模式下补填
 *
 * 这样 editing 时 user 改了 host 不重输密码也能测新值(host 用 body,password fallback DB)。
 */
async function runTestSsh(
  res: Response,
  userId: number,
  overrides: {
    deviceId?: number;
    ssh_host?: string;
    ssh_port?: number | string;
    ssh_user?: string;
    ssh_auth_type?: 'password' | 'private_key';
    ssh_password?: string;
    ssh_private_key?: string;
  },
): Promise<void> {
  // 1. device_id 提供时,从 DB 取设备并做 ownership 校验
  let device: DeviceRow | null = null;
  if (overrides.deviceId != null) {
    device = getDevice(overrides.deviceId);
    if (!device) {
      res.status(404).json({ code: 404, message: 'Device not found' });
      return;
    }
    if (device.user_id !== userId) {
      res.status(403).json({ code: 403, message: 'Forbidden' });
      return;
    }
  }

  // 2. 字段派生(body 优先,缺省 fallback DB)
  const host = overrides.ssh_host ?? device?.ssh_host ?? '';
  const user = overrides.ssh_user ?? device?.ssh_user ?? '';
  const auth = overrides.ssh_auth_type ?? device?.ssh_auth_type ?? '';
  const portNum = overrides.ssh_port != null
    ? (typeof overrides.ssh_port === 'number' ? overrides.ssh_port : Number(overrides.ssh_port))
    : (device?.ssh_port ?? 22);
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 22;

  if (!host || !user || !auth) {
    res.status(400).json({ code: 400, message: '请填写 SSH 主机、用户名和认证方式' });
    return;
  }

  // 3. password/private_key fallback(仅当 device 的 auth_type 与 body auth_type 一致)
  let password = overrides.ssh_password;
  let privateKey = overrides.ssh_private_key;
  if (auth === 'password' && !password) {
    if (device && device.ssh_auth_type === 'password' && device.ssh_password) {
      password = decryptColumn('ssh_password', device.ssh_password) ?? '';
    } else {
      res.status(400).json({ code: 400, message: '请填写 SSH 密码' });
      return;
    }
  }
  if (auth === 'private_key' && !privateKey) {
    if (device && device.ssh_auth_type === 'private_key' && device.ssh_private_key) {
      privateKey = decryptColumn('ssh_private_key', device.ssh_private_key) ?? '';
    } else {
      res.status(400).json({ code: 400, message: '请填写 SSH 私钥' });
      return;
    }
  }

  if (auth === 'password' && !password) {
    res.status(400).json({ code: 400, message: 'SSH 密码无法解密，请重新输入密码' });
    return;
  }
  if (auth === 'private_key' && !privateKey) {
    res.status(400).json({ code: 400, message: 'SSH 私钥无法解密，请重新输入私钥' });
    return;
  }

  const t0 = Date.now();
  console.log(`[routes:devices] test-ssh ${user}@${host}:${port} auth=${auth} source=device=${overrides.deviceId ?? 'none'}`);
  try {
    const { conn, end } = await connectSsh({
      host,
      port,
      username: user,
      password: auth === 'password' ? password : undefined,
      privateKey: auth === 'private_key' ? privateKey : undefined,
    });
    end();
    const ms = Date.now() - t0;
    console.log(`[routes:devices] test-ssh OK ${user}@${host}:${port} ${ms}ms`);
    res.json({ code: 200, message: 'ok', data: { ok: true, latency_ms: ms } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[routes:devices] test-ssh FAIL ${user}@${host}:${port}: ${msg}`);
    res.json({ code: 200, message: 'ok', data: { ok: false, error: msg } });
  }
}

/**
 * POST /api/devices/test-ssh
 * 测试 SSH 连接 — 用表单里填写的凭据直接连,不落库。
 * editing 时 body 带 device_id,后端缺省字段 fallback DB(实现见上方 runTestSsh)。
 * Body: { device_id?, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password?, ssh_private_key? }
 */
deviceRoutes.post('/test-ssh', async (req: Request, res: Response) => {
  const { device_id, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key } = req.body;
  await runTestSsh(res, req.user!.userId, {
    deviceId: device_id,
    ssh_host,
    ssh_port,
    ssh_user,
    ssh_auth_type,
    ssh_password,
    ssh_private_key,
  });
});

/**
 * POST /api/devices/:id/test-ssh
 * 2026-07-01: 保留向后兼容,但行为跟 POST /test-ssh(带 device_id)等价 — body 字段优先,
 * 缺省 fallback DB。前端不再直接用这个 endpoint,改走 /test-ssh + body device_id。
 */
deviceRoutes.post('/:id/test-ssh', async (req: Request, res: Response) => {
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  const { ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key } = req.body;
  await runTestSsh(res, req.user!.userId, {
    deviceId: device.id,
    ssh_host,
    ssh_port,
    ssh_user,
    ssh_auth_type,
    ssh_password,
    ssh_private_key,
  });
});

deviceRoutes.post('/:id/push-agent', async (req: Request, res: Response) => {
  console.log(`[routes:devices] POST /:id/push-agent id=${req.params.id}`);
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'web') {
    console.log(`[routes:devices] push-agent rejected: test_type=${device.test_type} (expected web)`);
    res.status(400).json({ code: 400, message: 'Only web devices support SSH push' });
    return;
  }
  if (!isPushEnabled()) {
    console.log(`[routes:devices] push-agent rejected: AGENT_SSH_KEY_SECRET not configured`);
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    console.log(`[routes:devices] push-agent rejected: SSH not configured (host=${device.ssh_host} user=${device.ssh_user} auth=${device.ssh_auth_type})`);
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  try {
    setPushProgress(device.id, { stage: 'bundling', message: '正在准备推送包', percent: 1 });
    console.log(`[routes:devices] push-agent starting device=${device.id} name="${device.name}" ssh=${device.ssh_user}@${device.ssh_host}:${device.ssh_port ?? 22}`);
    const result = await pushAgent(device, { onProgress: event => setPushProgress(device.id, event, event.stage !== 'done' && event.stage !== 'error') });
    if (!result.ok) {
      console.log(`[routes:devices] push-agent FAILED device=${device.id}: ${result.error}`);
      setPushProgress(device.id, { stage: 'error', message: result.error || 'push failed' }, false);
      res.status(500).json({
        code: 500,
        message: result.error || 'push failed',
        data: result,
      });
      return;
    }
    console.log(`[routes:devices] push-agent OK device=${device.id} version=${result.version} took=${result.took_ms}ms`);
    res.json({
      code: 200,
      message: 'Agent pushed and restarted',
      data: result,
    });
  } catch (err) {
    pushErrorResponse(res, device.id, 'push-agent', err);
  }
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
    res.status(500).json({ code: 500, message: result.error || 'stop failed', data: result });
    return;
  }
  markAgentOffline(device.id);
  res.json({ code: 200, message: 'Agent stopped' });
});

/**
 * POST /api/devices/:id/push-mobile-agent
 * 2026-06-08: 跟 push-agent 平行,推 mobile-agent bundle 到 mobile 设备。
 * systemd unit 名是 auto-test-mobile-agent.service,入口是
 * mobile-agent-src/index.js,听 4002 端口。
 */
deviceRoutes.post('/:id/push-mobile-agent', async (req: Request, res: Response) => {
  console.log(`[routes:devices] POST /:id/push-mobile-agent id=${req.params.id}`);
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'mobile') {
    console.log(`[routes:devices] push-mobile-agent rejected: test_type=${device.test_type} (expected mobile)`);
    res.status(400).json({ code: 400, message: 'Only mobile devices support push-mobile-agent' });
    return;
  }
  if (!isPushEnabled()) {
    console.log(`[routes:devices] push-mobile-agent rejected: AGENT_SSH_KEY_SECRET not configured`);
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    console.log(`[routes:devices] push-mobile-agent rejected: SSH not configured (host=${device.ssh_host} user=${device.ssh_user} auth=${device.ssh_auth_type})`);
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  try {
    setPushProgress(device.id, { stage: 'bundling', message: '正在准备推送包', percent: 1 });
    console.log(`[routes:devices] push-mobile-agent starting device=${device.id} name="${device.name}" ssh=${device.ssh_user}@${device.ssh_host}:${device.ssh_port ?? 22}`);
    const result = await pushMobileAgent(device, { onProgress: event => setPushProgress(device.id, event, event.stage !== 'done' && event.stage !== 'error') });
    if (!result.ok) {
      console.log(`[routes:devices] push-mobile-agent FAILED device=${device.id}: ${result.error}`);
      setPushProgress(device.id, { stage: 'error', message: result.error || 'push-mobile-agent failed' }, false);
      res.status(500).json({
        code: 500,
        message: result.error || 'push-mobile-agent failed',
        data: result,
      });
      return;
    }
    console.log(`[routes:devices] push-mobile-agent OK device=${device.id} version=${result.version} took=${result.took_ms}ms`);
    res.json({
      code: 200,
      message: 'Mobile agent pushed and restarted',
      data: result,
    });
  } catch (err) {
    pushErrorResponse(res, device.id, 'push-mobile-agent', err);
  }
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
    res.status(500).json({ code: 500, message: result.error || 'stop-mobile-agent failed', data: result });
    return;
  }
  markAgentOffline(device.id);
  res.json({ code: 200, message: 'Mobile agent stopped' });
});

/**
 * POST /api/devices/:id/push-pc-agent
 * 2026-06-15: 跟 push-agent/push-mobile-agent 平行,推 pc-agent bundle 到 PC 设备。
 * systemd unit 名是 auto-test-pc-agent.service,入口是 pc-agent-src/index.js,
 * 听 4003 端口。pc-agent 使用 @midscene/computer 驱动原生桌面。
 */
deviceRoutes.post('/:id/push-pc-agent', async (req: Request, res: Response) => {
  console.log(`[routes:devices] POST /:id/push-pc-agent id=${req.params.id}`);
  const device = requireOwnedDevice(req, res);
  if (!device) return;
  if (device.test_type !== 'pc') {
    console.log(`[routes:devices] push-pc-agent rejected: test_type=${device.test_type} (expected pc)`);
    res.status(400).json({ code: 400, message: 'Only PC devices support push-pc-agent' });
    return;
  }
  if (!isPushEnabled()) {
    console.log(`[routes:devices] push-pc-agent rejected: AGENT_SSH_KEY_SECRET not configured`);
    res.status(503).json({
      code: 503,
      message: 'Server has no AGENT_SSH_KEY_SECRET configured; SSH push is disabled. Set the env var on the central server and restart.',
    });
    return;
  }
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    console.log(`[routes:devices] push-pc-agent rejected: SSH not configured (host=${device.ssh_host} user=${device.ssh_user} auth=${device.ssh_auth_type})`);
    res.status(400).json({ code: 400, message: 'SSH host / user / auth type not configured for this device' });
    return;
  }

  try {
    setPushProgress(device.id, { stage: 'bundling', message: '正在准备推送包', percent: 1 });
    console.log(`[routes:devices] push-pc-agent starting device=${device.id} name="${device.name}" ssh=${device.ssh_user}@${device.ssh_host}:${device.ssh_port ?? 22}`);
    const result = await pushPcAgent(device, { onProgress: event => setPushProgress(device.id, event, event.stage !== 'done' && event.stage !== 'error') });
    if (!result.ok) {
      console.log(`[routes:devices] push-pc-agent FAILED device=${device.id}: ${result.error}`);
      setPushProgress(device.id, { stage: 'error', message: result.error || 'push-pc-agent failed' }, false);
      res.status(500).json({
        code: 500,
        message: result.error || 'push-pc-agent failed',
        data: result,
      });
      return;
    }
    console.log(`[routes:devices] push-pc-agent OK device=${device.id} version=${result.version} took=${result.took_ms}ms`);
    res.json({
      code: 200,
      message: 'PC agent pushed and restarted',
      data: result,
    });
  } catch (err) {
    pushErrorResponse(res, device.id, 'push-pc-agent', err);
  }
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
    res.status(500).json({ code: 500, message: result.error || 'stop-pc-agent failed', data: result });
    return;
  }
  markAgentOffline(device.id);
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

// GET /api/devices/:id/mobile-devices — fetch mobile devices from the agent
// Returns the list of Android/HarmonyOS/iOS devices connected to the agent machine.
deviceRoutes.get('/:id/mobile-devices', async (req: Request, res: Response) => {
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
  if (!device.agent_endpoint || !device.agent_token) {
    res.status(400).json({ code: 400, message: 'Agent not configured' });
    return;
  }
  try {
    const devices = await fetchMobileDevicesFromAgent(device.agent_endpoint, device.agent_token);
    res.json({ code: 200, message: 'ok', data: devices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch devices';
    console.error(`[routes:devices] fetch mobile-devices failed device=${id}: ${msg}`);
    res.status(500).json({ code: 500, message: msg });
  }
});
