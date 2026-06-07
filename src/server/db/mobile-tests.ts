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
}

export function findMobileTestsByUserIdPaginated(
  userId: number, page: number, pageSize: number, sort = 'updated_at', order = 'DESC'
): { items: MobileTestCaseRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const items = db.prepare(
    `SELECT * FROM mobile_test_cases WHERE user_id = ? ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(userId, pageSize, offset) as MobileTestCaseRow[];
  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM mobile_test_cases WHERE user_id = ?`
  ).get(userId) as { count: number };
  return { items, total: count };
}

export function findMobileTestById(id: number): MobileTestCaseRow | undefined {
  return db.prepare('SELECT * FROM mobile_test_cases WHERE id = ?').get(id) as MobileTestCaseRow | undefined;
}

export function createMobileTest(userId: number, data: CreateMobileTestInput): number {
  const result = db.prepare(
    `INSERT INTO mobile_test_cases (user_id, name, description, platform, device_name, platform_version, app_package, app_activity, bundle_id, appium_url, capabilities, test_script, assertions, preconditions, case_content, case_content_type, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(
    userId, data.name, data.description || null, data.platform || 'android',
    data.device_name || null, data.platform_version || null,
    data.app_package || null, data.app_activity || null, data.bundle_id || null,
    data.appium_url || 'http://localhost:4723', data.capabilities || null,
    data.test_script || null, data.assertions || null, data.preconditions || null,
    data.case_content ?? null, data.case_content_type ?? 'text',
    data.tags || '', data.status || 'active'
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
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
  created_at: string;
}

export function createMobileCaseExecution(caseId: number, userId: number, data: {
  started_at: string;
  executed_by: string | null;
  device_id?: number | null;
}): number {
  const result = db.prepare(
    `INSERT INTO mobile_case_executions (case_id, user_id, status, started_at, executed_by, device_id)
     VALUES (?, ?, 'running', ?, ?, ?)`
  ).run(caseId, userId, data.started_at, data.executed_by, data.device_id ?? null);
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
