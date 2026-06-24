import db from './index.js';

export interface WebCaseRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string | null;
  status: string;
  steps: string | null;        // JSON array of NL step objects (legacy, kept for back-compat)
  check_points: string | null; // JSON array of check point objects
  data_drive: string | null;   // JSON array of CSV data
  preconditions: string | null; // JSON array of precondition objects
  browser: string | null;
  window_size: string | null;
  timeout: number | null;
  headless_mode: number | null;
  base_url: string | null;
  case_content: string | null;       // Raw text or YAML — the new "用例内容" body
  case_content_type: string | null;  // 'text' | 'yaml'
  driver_path: string | null;        // Per-case Playwright driver dir override; null/empty = bundled default
  close_browser_after_execution: number | null; // 1=执行后销毁共享 Browser,0=保留给后续 case 复用
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreateWebCaseInput {
  name: string;
  description?: string;
  tags?: string;
  status?: string;
  steps?: string; // JSON string (legacy)
  check_points?: string; // JSON string
  data_drive?: string; // JSON string
  preconditions?: string; // JSON string
  browser?: string;
  window_size?: string;
  timeout?: number;
  headless_mode?: number;
  base_url?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  driver_path?: string | null;
  close_browser_after_execution?: number | null;
}

export interface UpdateWebCaseInput {
  name?: string;
  description?: string;
  tags?: string;
  status?: string;
  steps?: string; // JSON string (legacy)
  check_points?: string; // JSON string
  data_drive?: string; // JSON string
  preconditions?: string; // JSON string
  browser?: string;
  window_size?: string;
  timeout?: number;
  headless_mode?: number;
  base_url?: string;
  case_content?: string | null;
  case_content_type?: string | null;
  driver_path?: string | null;
  close_browser_after_execution?: number | null;
}

export interface WebCaseListFilter {
  name?: string;
  description?: string;
  tag?: string;
  status?: string;
  browser?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function listWebCases(
  userId: number,
  page: number,
  pageSize: number,
  sortField: string,
  sortOrder: string,
  filters: WebCaseListFilter
): { items: WebCaseRow[]; total: number; page: number; pageSize: number } {
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
  if (filters.browser) {
    conditions.push('browser = ?');
    values.push(filters.browser);
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
  const query = `SELECT * FROM web_test_cases WHERE ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) AS count FROM web_test_cases WHERE ${whereClause}`;

  const items = db.prepare(query).all(...values, pageSize, offset) as WebCaseRow[];
  const { count } = db.prepare(countQuery).get(...values) as { count: number };

  return { items, total: count, page, pageSize };
}

export function getWebCase(id: number): WebCaseRow | undefined {
  return db.prepare('SELECT * FROM web_test_cases WHERE id = ?').get(id) as WebCaseRow | undefined;
}

export function createWebCase(userId: number, data: CreateWebCaseInput): number {
  const result = db.prepare(
    `INSERT INTO web_test_cases (user_id, name, description, tags, status, steps, check_points, data_drive, preconditions, browser, window_size, timeout, headless_mode, base_url, case_content, case_content_type, driver_path, close_browser_after_execution, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(
    userId,
    data.name,
    data.description || null,
    data.tags || '',
    data.status || 'active',
    data.steps || null,
    data.check_points || null,
    data.data_drive || null,
    data.preconditions || null,
    data.browser || 'chromium',
    data.window_size || '1920x1080',
    data.timeout || 30000,
    data.headless_mode || 0,
    data.base_url || null,
    data.case_content ?? null,
    data.case_content_type ?? 'text',
    data.driver_path ?? null,
    data.close_browser_after_execution ?? 0
  );
  return result.lastInsertRowid as number;
}

export function updateWebCase(id: number, data: UpdateWebCaseInput): number {
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

  const result = db.prepare(`UPDATE web_test_cases SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes;
}

export function deleteWebCase(id: number): number {
  const result = db.prepare('DELETE FROM web_test_cases WHERE id = ?').run(id);
  return result.changes;
}

export interface WebCaseLogRow {
  id: number;
  case_id: number;
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
  executed_at: string;
}

export function createWebCaseLog(caseId: number, data: {
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO web_case_logs (case_id, status, duration_ms, executed_by, result, error_message, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
  ).run(caseId, data.status, data.duration_ms, data.executed_by, data.result, data.error_message);
  return result.lastInsertRowid as number;
}

export function findLogsByWebCaseId(caseId: number, limit = 10): WebCaseLogRow[] {
  return db.prepare('SELECT * FROM web_case_logs WHERE case_id = ? ORDER BY executed_at DESC LIMIT ?').all(caseId, limit) as WebCaseLogRow[];
}

// ── 标准化执行记录（web_case_executions）──
export interface WebCaseExecutionRow {
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

export function createWebCaseExecution(caseId: number, userId: number, data: {
  started_at: string;
  executed_by: string | null;
  device_id?: number | null;
}): number {
  const result = db.prepare(
    `INSERT INTO web_case_executions (case_id, user_id, status, started_at, executed_by, device_id)
     VALUES (?, ?, 'running', ?, ?, ?)`
  ).run(caseId, userId, data.started_at, data.executed_by, data.device_id ?? null);
  return result.lastInsertRowid as number;
}

// 2026-06-20: 设备级 busy 锁查询
export function findRunningWebExecutionByDevice(deviceId: number): { id: number } | null {
  return db.prepare(
    `SELECT id FROM web_case_executions WHERE device_id = ? AND status = 'running' LIMIT 1`
  ).get(deviceId) as { id: number } | null;
}

// 批量查询：一次拿到 N 个设备的 running 状态（给 merge 模块用）
export function findRunningWebExecutionsByDeviceIds(deviceIds: number[]): Map<number, { id: number }> {
  if (deviceIds.length === 0) return new Map();
  const placeholders = deviceIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, device_id FROM web_case_executions WHERE device_id IN (${placeholders}) AND status = 'running'`
  ).all(...deviceIds) as { id: number; device_id: number }[];
  const map = new Map<number, { id: number }>();
  for (const r of rows) map.set(r.device_id, { id: r.id });
  return map;
}

export function finishWebCaseExecution(id: number, data: {
  status: string;
  finished_at: string;
  duration_ms: number | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
}): number {
  const result = db.prepare(
    `UPDATE web_case_executions SET status = ?, finished_at = ?, duration_ms = ?, report_path = ?, report_type = ?, error_message = ? WHERE id = ?`
  ).run(data.status, data.finished_at, data.duration_ms, data.report_path, data.report_type, data.error_message, id);
  return result.changes;
}

export function findWebCaseExecutionsByCaseId(caseId: number, limit = 20): WebCaseExecutionRow[] {
  return db.prepare(
    'SELECT * FROM web_case_executions WHERE case_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(caseId, limit) as WebCaseExecutionRow[];
}

export function findWebCaseExecutionById(id: number): WebCaseExecutionRow | undefined {
  return db.prepare('SELECT * FROM web_case_executions WHERE id = ?').get(id) as WebCaseExecutionRow | undefined;
}