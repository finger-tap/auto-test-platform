import db from './index.js';

export interface PcCaseRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string | null;
  status: string;
  platform: string;                    // 'windows' | 'mac' | 'linux'
  steps: string | null;        // legacy NLStep[] JSON, kept for back-compat
  check_points: string | null;
  data_drive: string | null;
  window_size: string | null;
  timeout: number | null;
  preconditions: string | null;
  case_content: string | null;       // Raw text or YAML — the new "用例内容" body
  case_content_type: string | null;  // 'text' | 'yaml'
  driver_path: string | null;        // Per-case Playwright driver dir override; null/empty = bundled default (legacy, unused by ComputerAgent)
  close_browser_after_execution: number | null; // 1=执行后销毁共享 Browser,0=保留给后续 case 复用 (legacy, unused by ComputerAgent)
  // 2026-06-14: ComputerAgent (native desktop) options. Map to ComputerDeviceOpt.
  display_id: string | null;          // 多显示器场景指定目标屏;null/空=主屏
  keyboard_driver: string | null;     // macOS 键盘驱动:'applescript'(默认,稳)|'libnut'(快)
  xvfb_resolution: string | null;     // Linux headless 的 Xvfb 虚拟屏分辨率,如 '1920x1080x24'
  headless: number | null;            // 1=Linux 下启 Xvfb headless;0=前台执行
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreatePcCaseInput {
  name: string;
  description?: string;
  tags?: string;
  status?: string;
  platform?: string;
  steps?: string;
  check_points?: string;
  data_drive?: string;
  window_size?: string;
  timeout?: number;
  preconditions?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  driver_path?: string | null;
  close_browser_after_execution?: number | null;
  display_id?: string | null;
  keyboard_driver?: string | null;
  xvfb_resolution?: string | null;
  headless?: number | null;
}

export interface UpdatePcCaseInput {
  name?: string;
  description?: string;
  tags?: string;
  status?: string;
  platform?: string;
  steps?: string;
  check_points?: string;
  data_drive?: string;
  window_size?: string;
  timeout?: number;
  preconditions?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  driver_path?: string | null;
  close_browser_after_execution?: number | null;
  display_id?: string | null;
  keyboard_driver?: string | null;
  xvfb_resolution?: string | null;
  headless?: number | null;
}

export interface PcCaseLogRow {
  id: number;
  case_id: number;
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
  executed_at: string;
}

export interface PcCaseListFilter {
  name?: string;
  description?: string;
  tag?: string;
  status?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function listPcCases(
  userId: number,
  page: number,
  pageSize: number,
  sortField: string,
  sortOrder: string,
  filters: PcCaseListFilter
): { items: PcCaseRow[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = {
    updated_at: 'updated_at',
    created_at: 'created_at',
    name: 'name',
  };
  const sortCol = validSorts[sortField] || 'updated_at';
  const sortDir = sortOrder === 'ASC' ? 'ASC' : 'DESC';

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
  const query = `SELECT * FROM pc_test_cases WHERE ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) AS count FROM pc_test_cases WHERE ${whereClause}`;

  const items = db.prepare(query).all(...values, pageSize, offset) as PcCaseRow[];
  const { count } = db.prepare(countQuery).get(...values) as { count: number };

  return { items, total: count, page, pageSize };
}

export function getPcCase(id: number): PcCaseRow | undefined {
  return db.prepare('SELECT * FROM pc_test_cases WHERE id = ?').get(id) as PcCaseRow | undefined;
}

export function findPcCaseByName(userId: number, name: string): PcCaseRow | undefined {
  return db.prepare('SELECT * FROM pc_test_cases WHERE user_id = ? AND name = ?').get(userId, name) as PcCaseRow | undefined;
}

export function createPcCase(userId: number, data: CreatePcCaseInput): number {
  const result = db.prepare(
    `INSERT INTO pc_test_cases (user_id, name, description, tags, status, platform, steps, check_points, data_drive, preconditions, window_size, timeout, case_content, case_content_type, driver_path, close_browser_after_execution, display_id, keyboard_driver, xvfb_resolution, headless, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(
    userId,
    data.name,
    data.description || null,
    data.tags || '',
    data.status || 'active',
    data.platform || 'windows',
    data.steps || null,
    data.check_points || null,
    data.data_drive || null,
    data.preconditions || null,
    data.window_size || '1920x1080',
    data.timeout || 30000,
    data.case_content ?? null,
    data.case_content_type ?? 'text',
    data.driver_path ?? null,
    data.close_browser_after_execution ?? 0,
    data.display_id ?? null,
    data.keyboard_driver ?? null,
    data.xvfb_resolution ?? null,
    data.headless ?? 0
  );
  return result.lastInsertRowid as number;
}

export function updatePcCase(id: number, data: UpdatePcCaseInput): number {
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

  const result = db.prepare(`UPDATE pc_test_cases SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes;
}

export function deletePcCase(id: number): number {
  const result = db.prepare('DELETE FROM pc_test_cases WHERE id = ?').run(id);
  return result.changes;
}

export function createPcCaseLog(caseId: number, data: {
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO pc_case_logs (case_id, status, duration_ms, executed_by, result, error_message, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
  ).run(caseId, data.status, data.duration_ms, data.executed_by, data.result, data.error_message);
  return result.lastInsertRowid as number;
}

export function findLogsByPcCaseId(caseId: number, limit = 10): PcCaseLogRow[] {
  return db.prepare('SELECT * FROM pc_case_logs WHERE case_id = ? ORDER BY executed_at DESC LIMIT ?').all(caseId, limit) as PcCaseLogRow[];
}

// ── 标准化执行记录（pc_case_executions）──
export interface PcCaseExecutionRow {
  id: number;
  case_id: number;
  user_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
  created_at: string;
}

export function createPcCaseExecution(caseId: number, userId: number, data: {
  started_at: string;
  executed_by: string | null;
  device_id?: number | null;
}): number {
  const result = db.prepare(
    `INSERT INTO pc_case_executions (case_id, user_id, status, started_at, executed_by, device_id)
     VALUES (?, ?, 'running', ?, ?, ?)`
  ).run(caseId, userId, data.started_at, data.executed_by, data.device_id ?? null);
  return result.lastInsertRowid as number;
}

// 2026-06-20: 设备级 busy 锁查询
export function findRunningPcExecutionByDevice(deviceId: number): { id: number } | null {
  return db.prepare(
    `SELECT id FROM pc_case_executions WHERE device_id = ? AND status = 'running' LIMIT 1`
  ).get(deviceId) as { id: number } | null;
}

// 批量查询：一次拿到 N 个设备的 running 状态（给 merge 模块用）
export function findRunningPcExecutionsByDeviceIds(deviceIds: number[]): Map<number, { id: number }> {
  if (deviceIds.length === 0) return new Map();
  const placeholders = deviceIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, device_id FROM pc_case_executions WHERE device_id IN (${placeholders}) AND status = 'running'`
  ).all(...deviceIds) as { id: number; device_id: number }[];
  const map = new Map<number, { id: number }>();
  for (const r of rows) map.set(r.device_id, { id: r.id });
  return map;
}

export function finishPcCaseExecution(id: number, data: {
  status: string;
  finished_at: string;
  duration_ms: number | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
}): number {
  const result = db.prepare(
    `UPDATE pc_case_executions SET status = ?, finished_at = ?, duration_ms = ?, report_path = ?, report_type = ?, error_message = ? WHERE id = ?`
  ).run(data.status, data.finished_at, data.duration_ms, data.report_path, data.report_type, data.error_message, id);
  return result.changes;
}

export function findPcCaseExecutionsByCaseId(caseId: number, limit = 20): PcCaseExecutionRow[] {
  return db.prepare(
    'SELECT * FROM pc_case_executions WHERE case_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(caseId, limit) as PcCaseExecutionRow[];
}

export function findPcCaseExecutionById(id: number): PcCaseExecutionRow | undefined {
  return db.prepare('SELECT * FROM pc_case_executions WHERE id = ?').get(id) as PcCaseExecutionRow | undefined;
}