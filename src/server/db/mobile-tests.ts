import db from './index.js';

export interface MobileTestCaseRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  platform: string;           // 'android' | 'ios' | 'harmony'
  device_name: string | null;
  platform_version: string | null;
  app_package: string | null;
  app_activity: string | null;
  bundle_id: string | null;
  appium_url: string | null;
  capabilities: string | null;
  test_script: string | null;          // legacy 10-action JSON, kept for back-compat
  assertions: string | null;
  preconditions: string | null;
  case_content: string | null;         // Raw text or YAML — the new "用例内容" body
  case_content_type: string | null;    // 'text' | 'yaml'
  tags: string | null;
  status: string;
  app_id: number | null;              // FK → mobile_apps(id)
  app_version: string | null;         // 指定安装版本（空=最新版）
  created_at: string;
  updated_at: string;
}

export interface MobileTestLogRow {
  id: number;
  test_case_id: number;
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
  screenshots: string | null;
  executed_at: string;
}

export interface CreateMobileTestInput {
  name: string;
  description?: string;
  platform?: string;
  device_name?: string;
  platform_version?: string;
  app_package?: string;
  app_activity?: string;
  bundle_id?: string;
  appium_url?: string;
  capabilities?: string;
  test_script?: string;
  assertions?: string;
  preconditions?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  tags?: string;
  status?: string;
  app_id?: number | null;
  app_version?: string | null;
}

export interface UpdateMobileTestInput {
  name?: string;
  description?: string;
  platform?: string;
  device_name?: string;
  platform_version?: string;
  app_package?: string;
  app_activity?: string;
  bundle_id?: string;
  appium_url?: string;
  capabilities?: string;
  test_script?: string;
  assertions?: string;
  preconditions?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  tags?: string;
  status?: string;
  app_id?: number | null;
  app_version?: string | null;
}

export interface MobileTestListFilter {
  name?: string;
  description?: string;
  tag?: string;
  status?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function findMobileTestsByUserIdPaginated(
  userId: number, page: number, pageSize: number,
  sort = 'updated_at', order = 'DESC',
  filters: MobileTestListFilter = {}
): { items: MobileTestCaseRow[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';

  const conditions: string[] = ['user_id = ?'];
  const values: unknown[] = [userId];

  if (filters.name) {
    conditions.push('name LIKE ?');
    values.push(`%${filters.name}%`);
  }
  if (filters.description) {
    conditions.push('description LIKE ?');
    values.push(`%${filters.description}%`);
  }
  if (filters.tag) {
    conditions.push('tags LIKE ?');
    values.push(`%${filters.tag}%`);
  }
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  if (filters.platform) {
    conditions.push('platform = ?');
    values.push(filters.platform);
  }
  if (filters.dateFrom) {
    conditions.push('created_at >= ?');
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('created_at <= ?');
    values.push(filters.dateTo + 'T23:59:59');
  }

  const whereClause = conditions.join(' AND ');
  const items = db.prepare(
    `SELECT * FROM mobile_test_cases WHERE ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(...values, pageSize, offset) as MobileTestCaseRow[];
  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM mobile_test_cases WHERE ${whereClause}`
  ).get(...values) as { count: number };
  return { items, total: count, page, pageSize };
}

export function findMobileTestById(id: number): MobileTestCaseRow | undefined {
  return db.prepare('SELECT * FROM mobile_test_cases WHERE id = ?').get(id) as MobileTestCaseRow | undefined;
}

export function findMobileTestByName(userId: number, name: string): MobileTestCaseRow | undefined {
  return db.prepare('SELECT * FROM mobile_test_cases WHERE user_id = ? AND name = ?').get(userId, name) as MobileTestCaseRow | undefined;
}

export function createMobileTest(userId: number, data: CreateMobileTestInput): number {
  const result = db.prepare(
    `INSERT INTO mobile_test_cases (user_id, name, description, platform, device_name, platform_version, app_package, app_activity, bundle_id, appium_url, capabilities, test_script, assertions, preconditions, case_content, case_content_type, tags, status, app_id, app_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(
    userId, data.name, data.description || null, data.platform || 'android',
    data.device_name || null, data.platform_version || null,
    data.app_package || null, data.app_activity || null, data.bundle_id || null,
    data.appium_url || 'http://localhost:4723', data.capabilities || null,
    data.test_script || null, data.assertions || null, data.preconditions || null,
    data.case_content ?? null, data.case_content_type ?? 'text',
    data.tags || '', data.status || 'active',
    data.app_id ?? null, data.app_version ?? null
  );
  return result.lastInsertRowid as number;
}

export function updateMobileTest(id: number, data: UpdateMobileTestInput): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id);
  const result = db.prepare(`UPDATE mobile_test_cases SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteMobileTest(id: number): boolean {
  const result = db.prepare('DELETE FROM mobile_test_cases WHERE id = ?').run(id);
  return result.changes > 0;
}

export function createMobileTestLog(testCaseId: number, data: {
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
  screenshots: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO mobile_test_logs (test_case_id, status, duration_ms, executed_by, result, error_message, screenshots, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
  ).run(testCaseId, data.status, data.duration_ms, data.executed_by, data.result, data.error_message, data.screenshots);
  return result.lastInsertRowid as number;
}

export function findLogsByMobileTestCaseId(testCaseId: number, limit = 10): MobileTestLogRow[] {
  return db.prepare(
    'SELECT * FROM mobile_test_logs WHERE test_case_id = ? ORDER BY executed_at DESC LIMIT ?'
  ).all(testCaseId, limit) as MobileTestLogRow[];
}

// ── 标准化执行记录（mobile_case_executions）──
export interface MobileCaseExecutionRow {
  id: number;
  case_id: number;
  user_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  device_id: number | null;
  local_device_key: string | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
  created_at: string;
}

export function createMobileCaseExecution(caseId: number, userId: number, data: {
  started_at: string;
  executed_by: string | null;
  device_id?: number | null;
  local_device_key?: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO mobile_case_executions (case_id, user_id, status, started_at, executed_by, device_id, local_device_key)
     VALUES (?, ?, 'running', ?, ?, ?, ?)`
  ).run(caseId, userId, data.started_at, data.executed_by, data.device_id ?? null, data.local_device_key ?? null);
  return result.lastInsertRowid as number;
}

export function finishMobileCaseExecution(id: number, data: {
  status: string;
  finished_at: string;
  duration_ms: number | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
}): number {
  const result = db.prepare(
    `UPDATE mobile_case_executions SET status = ?, finished_at = ?, duration_ms = ?, report_path = ?, report_type = ?, error_message = ? WHERE id = ?`
  ).run(data.status, data.finished_at, data.duration_ms, data.report_path, data.report_type, data.error_message, id);
  return result.changes;
}

export function findMobileCaseExecutionsByCaseId(caseId: number, limit = 20): MobileCaseExecutionRow[] {
  return db.prepare(
    'SELECT * FROM mobile_case_executions WHERE case_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(caseId, limit) as MobileCaseExecutionRow[];
}

export function findMobileCaseExecutionById(id: number): MobileCaseExecutionRow | undefined {
  return db.prepare('SELECT * FROM mobile_case_executions WHERE id = ?').get(id) as MobileCaseExecutionRow | undefined;
}

// 2026-06-10: 设备级执行 busy 锁 — 查某台设备是否已有 running execution。
// 用于 routes/mobile-tests.ts 在创建新执行前判断是否需要返回 409。
// 单进程内 routes/mobile-tests.ts 的 withDeviceLock 互斥 + 这条 SQL 一起保证一致性;
// DB 还有 partial UNIQUE INDEX idx_mobile_case_executions_running_per_device 兜底多进程。
export function findRunningExecutionByDevice(deviceId: number): MobileCaseExecutionRow | null {
  return db.prepare(
    `SELECT * FROM mobile_case_executions WHERE device_id = ? AND status = 'running' LIMIT 1`
  ).get(deviceId) as MobileCaseExecutionRow | null ?? null;
}

// 2026-06-11: 按 local_device_key 查 running — 本地设备 busy 判断走 DB
export function findRunningExecutionByLocalDeviceKey(key: string): MobileCaseExecutionRow | null {
  return db.prepare(
    `SELECT * FROM mobile_case_executions WHERE local_device_key = ? AND status = 'running' LIMIT 1`
  ).get(key) as MobileCaseExecutionRow | null ?? null;
}

/**
 * 批量查一批 deviceId 各自的 running execution(0 或 1 行/device)。
 * 给 devices/merge.ts 用 — 一次查询搞定 N 个设备的 busy 状态,避免 N+1。
 * 返回 Map<deviceId, row> — 没在跑的设备不进入 Map。
 */
export function findRunningExecutionsByDeviceIds(deviceIds: number[]): Map<number, MobileCaseExecutionRow> {
  const result = new Map<number, MobileCaseExecutionRow>();
  if (deviceIds.length === 0) return result;
  const unique = Array.from(new Set(deviceIds));
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM mobile_case_executions WHERE device_id IN (${placeholders}) AND status = 'running'`
  ).all(...unique) as MobileCaseExecutionRow[];
  for (const r of rows) {
    if (r.device_id != null) result.set(r.device_id, r);
  }
  return result;
}

// 2026-06-11: 批量查本地设备的 running execution,给 merge.ts 用
export function findRunningExecutionsByLocalDeviceKeys(keys: string[]): Map<string, MobileCaseExecutionRow> {
  const result = new Map<string, MobileCaseExecutionRow>();
  if (keys.length === 0) return result;
  const unique = Array.from(new Set(keys));
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM mobile_case_executions WHERE local_device_key IN (${placeholders}) AND status = 'running'`
  ).all(...unique) as MobileCaseExecutionRow[];
  for (const r of rows) {
    if (r.local_device_key != null) result.set(r.local_device_key, r);
  }
  return result;
}
