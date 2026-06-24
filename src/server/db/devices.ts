import db from './index.js';
import crypto from 'node:crypto';

export type DeviceTestType = 'web' | 'pc' | 'mobile';
export type DeviceStatus = 'online' | 'offline' | 'unknown';

export interface DeviceRow {
  id: number;
  user_id: number;
  name: string;
  test_type: DeviceTestType;
  platform: string;
  serial: string | null;
  host: string | null;
  status: DeviceStatus;
  last_heartbeat: string | null;
  metadata: string | null;
  // 2026-06-06 agent fields
  agent_token: string | null;
  agent_endpoint: string | null;
  agent_version: string | null;
  last_seen_at: string | null;
  // 2026-06-07 SSH push fields. ssh_password / ssh_private_key hold AES-256-GCM
  // ciphertext (JSON: {iv, ciphertext, tag}) — never plain. needs_upgrade is
  // 0/1 and is set by the server's startup version scan. last_push_* is the
  // audit trail of the last successful/failed SSH push.
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_user: string | null;
  ssh_auth_type: 'password' | 'private_key' | null;
  ssh_password: string | null;
  ssh_private_key: string | null;
  os_type: string | null;
  needs_upgrade: 0 | 1;
  last_push_at: string | null;
  last_push_status: 'ok' | 'error' | null;
  last_push_error: string | null;
  // 2026-06-08 Mobile 屏幕预览字段:
  //   preview_kind  'scrcpy' | 'mjpeg' | 'screenshot' | null — 决定 preview-manager 用哪条 relay
  //   last_rich_info_at  上次从 adb / hdc / xcrun 查到完整 rich info 的时间,30s 缓存窗口
  //   ssh_tunnel_port  server 端 SSH LocalForward 占用的 127.0.0.1 端口
  //   mobile_agent_port  mobile-agent 监听端口,默认 4002
  preview_kind: 'scrcpy' | 'mjpeg' | 'screenshot' | null;
  last_rich_info_at: string | null;
  ssh_tunnel_port: number | null;
  mobile_agent_port: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDeviceInput {
  name: string;
  test_type: DeviceTestType;
  platform: string;
  serial?: string;
  host?: string;
  status?: DeviceStatus;
  metadata?: string;
  // 2026-06-07: optional SSH fields at create time. Same shape as Update.
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_auth_type?: 'password' | 'private_key';
  ssh_password?: string;
  ssh_private_key?: string;
  os_type?: string;
}

export interface UpdateDeviceInput {
  name?: string;
  platform?: string;
  serial?: string;
  host?: string;
  status?: DeviceStatus;
  metadata?: string;
  agent_endpoint?: string;
  agent_version?: string;
  // 2026-06-07: SSH push fields. Setting ssh_password / ssh_private_key to
  // null clears the field (used by the UI's "clear" button).
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_type?: 'password' | 'private_key' | null;
  ssh_password?: string | null;
  ssh_private_key?: string | null;
  os_type?: string | null;
}

interface ListFilter {
  test_type?: DeviceTestType;
  status?: DeviceStatus;
  keyword?: string;
}

export function listDevices(
  userId: number,
  filters: ListFilter = {}
): DeviceRow[] {
  const conditions: string[] = ['user_id = ?'];
  const values: unknown[] = [userId];

  if (filters.test_type) {
    conditions.push('test_type = ?');
    values.push(filters.test_type);
  }
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  if (filters.keyword) {
    conditions.push('(name LIKE ? OR serial LIKE ? OR host LIKE ?)');
    const kw = `%${filters.keyword}%`;
    values.push(kw, kw, kw);
  }

  return db.prepare(
    `SELECT * FROM devices WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`
  ).all(...values) as DeviceRow[];
}

export function getDevice(id: number): DeviceRow | undefined {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
}

/**
 * 2026-06-06: user-scoped variant — used by the executor before launching
 * a browser on someone else's device (we don't want to leak device rows
 * across users). Returns null if the id doesn't exist OR isn't owned by
 * the requesting user.
 */
export function getDeviceForUser(id: number, userId: number): DeviceRow | null {
  const row = db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(id, userId) as DeviceRow | undefined;
  return row ?? null;
}

/**
 * Generate a per-device bearer token. UUIDv4 — long enough to be unguessable,
 * short enough to be pasted into an env var.
 */
export function generateAgentToken(): string {
  return crypto.randomUUID();
}

export function createDevice(userId: number, data: CreateDeviceInput): number {
  // 2026-06-06: every device gets an agent_token up-front so the user can
  // deploy the agent at any time without a schema migration later. Tokens
  // are unique-constrained; we re-generate on the (vanishingly rare) collision.
  let agentToken = generateAgentToken();
  for (let i = 0; i < 3; i++) {
    const exists = db.prepare('SELECT 1 FROM devices WHERE agent_token = ?').get(agentToken);
    if (!exists) break;
    agentToken = generateAgentToken();
  }

  const result = db.prepare(
    `INSERT INTO devices (
       user_id, name, test_type, platform, serial, host, status, metadata,
       agent_token, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password,
       ssh_private_key, os_type, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(
    userId,
    data.name,
    data.test_type,
    data.platform,
    data.serial || null,
    data.host || null,
    data.status || 'unknown',
    data.metadata || '{}',
    agentToken,
    data.ssh_host || null,
    data.ssh_port ?? 22,
    data.ssh_user || null,
    data.ssh_auth_type || null,
    data.ssh_password || null,   // already-encrypted ciphertext from caller
    data.ssh_private_key || null,
    data.os_type || 'linux'
  );
  return result.lastInsertRowid as number;
}

export function updateDevice(id: number, data: UpdateDeviceInput): number {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return 0;
  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id);

  const result = db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes;
}

export function deleteDevice(id: number): number {
  const result = db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  return result.changes;
}

export function refreshDeviceStatus(id: number, status: DeviceStatus): number {
  const result = db.prepare(
    `UPDATE devices SET status = ?, last_heartbeat = datetime('now', '+8 hours'), updated_at = datetime('now', '+8 hours') WHERE id = ?`
  ).run(status, id);
  return result.changes;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2026-06-06: agent helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Look up a device by its agent_token. Used by the agent auth middleware to
 * resolve the bearer token into a device row.
 */
export function getDeviceByAgentToken(token: string): DeviceRow | undefined {
  return db.prepare(
    'SELECT * FROM devices WHERE agent_token = ?'
  ).get(token) as DeviceRow | undefined;
}

/**
 * Agent registration: stores the agent's reachable URL and version, marks
 * the device online, updates last_seen_at. Called on startup and on every
 * heartbeat.
 */
export function updateAgentHeartbeat(
  id: number,
  agentEndpoint: string,
  agentVersion: string
): number {
  return db.prepare(
    `UPDATE devices
        SET agent_endpoint = ?, agent_version = ?, status = 'online',
            last_seen_at = datetime('now', '+8 hours'),
            updated_at = datetime('now', '+8 hours')
      WHERE id = ?`
  ).run(agentEndpoint, agentVersion, id).changes;
}

/**
 * Agent graceful shutdown: mark offline but keep agent_endpoint so we know
 * where the agent *was* reachable. The next heartbeat (if agent restarts)
 * will flip it back to online.
 */
export function markAgentOffline(id: number): number {
  return db.prepare(
    `UPDATE devices
        SET status = 'offline', updated_at = datetime('now', '+8 hours')
      WHERE id = ?`
  ).run(id).changes;
}

/**
 * 2026-06-09: 持久化 mobile-agent 上报的设备列表到 `devices.metadata`。
 * 给的是 agent 拉到的本机设备(Android/Harmony/iOS)原始行 — server 端 merge.ts
 * 读 metadata 时按 JSON 反序列化、配合 server 端本地 adb/hdc 的数据合并。
 *
 * items 是 array,不是单设备行 — 一台远端 Linux 上可能接多台设备。
 * metadata 字段沿用 TEXT (JSON 序列化),不做 schema 校验,merge.ts 解析时
 * 容忍字段缺失(老数据 / 部分字段查不到都正常)。
 *
 * 不动 status / agent_endpoint — heartbeat 自己管那些字段。
 */
export function updateAgentDeviceMetadata(id: number, items: unknown[]): number {
  return db.prepare(
    `UPDATE devices
        SET metadata = ?, last_rich_info_at = datetime('now', '+8 hours'),
            updated_at = datetime('now', '+8 hours')
      WHERE id = ?`
  ).run(JSON.stringify(items), id).changes;
}

/**
 * Cron job: sweep all devices with an agent_token whose last_seen_at is
 * older than `staleSeconds` ago. Sets them to offline. Idempotent — devices
 * that are already offline are left alone.
 */
export function markStaleAgentsOffline(staleSeconds: number): { scanned: number; flipped: number } {
  // Subquery form: we want the count BEFORE the update for logging, so do
  // it in two statements. SQLite is single-writer so the count-then-flip
  // is safe for our scheduler cadence.
  const candidates = db.prepare(
    `SELECT id FROM devices
       WHERE agent_token IS NOT NULL
         AND status = 'online'
         AND (last_seen_at IS NULL
              OR last_seen_at < datetime('now', '+8 hours', '-' || ? || ' seconds'))`
  ).all(staleSeconds) as { id: number }[];

  if (candidates.length === 0) return { scanned: 0, flipped: 0 };

  const flip = db.prepare(
    `UPDATE devices SET status = 'offline', updated_at = datetime('now', '+8 hours')
      WHERE id = ?`
  );
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) flip.run(id);
  });
  tx(candidates.map((c) => c.id));

  return { scanned: candidates.length, flipped: candidates.length };
}

/**
 * 2026-06-07: list all web devices that have a registered agent
 * (agent_token IS NOT NULL). Used by the startup version scan.
 */
export function listWebDevicesWithAgent(): DeviceRow[] {
  return db.prepare(
    `SELECT * FROM devices
       WHERE test_type = 'web' AND agent_token IS NOT NULL
       ORDER BY id`
  ).all() as DeviceRow[];
}

/**
 * 2026-06-08: 同上,但只列 mobile 设备。mobile-agent 跟 web-agent 共享
 * `agent_token` / `agent_version` 字段(version 协议也相同),所以 mobile
 * 也走同一份 startup version scan。
 */
export function listMobileDevicesWithAgent(): DeviceRow[] {
  return db.prepare(
    `SELECT * FROM devices
       WHERE test_type = 'mobile' AND agent_token IS NOT NULL
       ORDER BY id`
  ).all() as DeviceRow[];
}

// ──────────────────────────────────────────────────────────────────────────────
// 2026-06-07: SSH push helpers (see src/server/agent-push/push.ts)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Mark the result of the most recent SSH push attempt. The UI shows this
 * in the Agent Info modal. `error` is truncated to 4KB to keep the row
 * slim — full error context lives in the server console.
 */
export function recordPushResult(
  id: number,
  status: 'ok' | 'error',
  error?: string
): number {
  const trimmed = error ? error.slice(0, 4096) : null;
  return db.prepare(
    `UPDATE devices
        SET last_push_at = datetime('now', '+8 hours'),
            last_push_status = ?,
            last_push_error = ?,
            -- A successful push means the agent should now match the server's
            -- required version; clear the needs_upgrade flag. A failed push
            -- doesn't change the flag (the version mismatch is still real).
            needs_upgrade = CASE WHEN ? = 'ok' THEN 0 ELSE needs_upgrade END,
            updated_at = datetime('now', '+8 hours')
      WHERE id = ?`
  ).run(status, trimmed, status, id).changes;
}

/**
 * Set the `needs_upgrade` flag for a single device. Used by the startup
 * version scan and by tests.
 */
export function setNeedsUpgrade(id: number, needs: boolean): number {
  return db.prepare(
    `UPDATE devices SET needs_upgrade = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?`
  ).run(needs ? 1 : 0, id).changes;
}

/**
 * Get the current server-expected version for an agent, by reading
 * package.json at the project root. Used by the startup scan to compare
 * against each device's last seen agent_version. Cached after first call.
 */
export function getRequiredAgentVersion(): string {
  if (_requiredVersionCache !== null) return _requiredVersionCache;
  try {
    // project root is 4 levels up from src/server/db/devices.ts:
    //   devices.ts → db/ → server/ → src/ → <root>
    // Use createRequire so we can use require() inside an ESM module.
    const { createRequire } = require('node:module') as typeof import('node:module');
    const req = createRequire(import.meta.url);
    const pkg = req('../../../../package.json') as { version?: string };
    _requiredVersionCache = pkg.version ?? 'unknown';
  } catch {
    _requiredVersionCache = 'unknown';
  }
  return _requiredVersionCache;
}
let _requiredVersionCache: string | null = null;
