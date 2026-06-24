import db from './index.js';

export interface ApiRow {
  id: number;
  user_id: number;
  name: string;
  method: string;
  url: string;
  protocol: string;
  headers: string | null;
  body: string | null;
  description: string | null;
  tags: string | null;
  status: string;
  content_type: string | null;
  assertions: string | null;
  pre_script: string | null;
  post_script: string | null;
  pre_db_name: string | null;
  pre_db_query: string | null;
  post_db_name: string | null;
  post_db_query: string | null;
  pre_assertions: string | null;
  post_assertions: string | null;
  final_assertions: string | null;
  ws_send: string | null;
  ws_expect: string | null;
  pre_actions: string | null;
  post_actions: string | null;
  parameters: string | null;  // JSON: { enabled: boolean, source: 'csv'|'manual', headers: string[], rows: string[][] }
  ssl_cert_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiLogRow {
  id: number;
  api_id: number;
  status_code: number | null;
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: string | null;
  executed_at: string;
}

export interface AssertionRule {
  name?: string;
  source: 'status' | 'header' | 'body' | 'vars' | 'result' | 'row_count';
  key: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;
  assert?: boolean;
}

export type AssertionResult = { rule: AssertionRule; passed: boolean; actual: string };

export interface CreateApiInput {
  name: string;
  method: string;
  url: string;
  protocol?: string;
  headers?: string;
  body?: string;
  description?: string;
  tags?: string;
  status?: string;
  content_type?: string;
  assertions?: string;
  pre_script?: string;
  post_script?: string;
  pre_db_name?: string;
  pre_db_query?: string;
  post_db_name?: string;
  post_db_query?: string;
  pre_assertions?: string;
  post_assertions?: string;
  final_assertions?: string;
  ws_send?: string;
  ws_expect?: string;
  pre_actions?: string;
  post_actions?: string;
  parameters?: string;
  ssl_cert_name?: string;
}

export interface UpdateApiInput {
  name?: string;
  method?: string;
  url?: string;
  protocol?: string;
  headers?: string;
  body?: string;
  description?: string;
  tags?: string;
  status?: string;
  content_type?: string;
  assertions?: string;
  pre_script?: string;
  post_script?: string;
  pre_db_name?: string;
  pre_db_query?: string;
  post_db_name?: string;
  post_db_query?: string;
  pre_assertions?: string;
  post_assertions?: string;
  final_assertions?: string;
  ws_send?: string;
  ws_expect?: string;
  pre_actions?: string;
  post_actions?: string;
  parameters?: string;
  ssl_cert_name?: string;
}

export interface ApiListFilter {
  name?: string;
  description?: string;
  tag?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function findApisByUserIdPaginated(
  userId: number, page: number, pageSize: number,
  sort = 'updated_at', order = 'DESC',
  filters: ApiListFilter = {}
): { items: ApiRow[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name', url: 'url' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';

  const conditions: string[] = ['user_id = ?'];
  const values: unknown[] = [userId];

  if (filters.name) {
    conditions.push('(name LIKE ? OR url LIKE ?)');
    values.push(`%${filters.name}%`, `%${filters.name}%`);
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
  if (filters.dateFrom) {
    conditions.push('created_at >= ?');
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('created_at <= ?');
    values.push(filters.dateTo + 'T23:59:59');
  }

  const whereClause = conditions.join(' AND ');
  const items = db.prepare(`SELECT * FROM apis WHERE ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(...values, pageSize, offset) as ApiRow[];
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM apis WHERE ${whereClause}`).get(...values) as { count: number };
  return { items, total: count, page, pageSize };
}

export function findApisByUserId(userId: number): ApiRow[] {
  return db.prepare('SELECT * FROM apis WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ApiRow[];
}

export function findApiById(id: number): ApiRow | undefined {
  return db.prepare('SELECT * FROM apis WHERE id = ?').get(id) as ApiRow | undefined;
}

export function createApi(userId: number, data: CreateApiInput): number {
  const result = db.prepare(
    `INSERT INTO apis (user_id, name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, parameters, ssl_cert_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(userId, data.name, data.method, data.url, data.protocol || 'https', data.headers || null, data.body || null, data.description || null, data.tags || '', data.status || 'active', data.content_type || 'json', data.assertions || null, data.pre_script || null, data.post_script || null, data.pre_db_name || null, data.pre_db_query || null, data.post_db_name || null, data.post_db_query || null, data.pre_assertions || null, data.post_assertions || null, data.final_assertions || null, data.ws_send || null, data.ws_expect || null, data.parameters || null, data.ssl_cert_name || null);
  return result.lastInsertRowid as number;
}

export function updateApi(id: number, data: UpdateApiInput): boolean {
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

  const result = db.prepare(`UPDATE apis SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteApi(id: number): boolean {
  const result = db.prepare('DELETE FROM apis WHERE id = ?').run(id);
  return result.changes > 0;
}

export function createApiLog(apiId: number, data: {
  status_code: number | null;
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO api_logs (api_id, status_code, request_headers, request_body, response_headers, response_body, duration_ms, executed_by, assertion_results, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
  ).run(apiId, data.status_code, data.request_headers, data.request_body, data.response_headers, data.response_body, data.duration_ms, data.executed_by, data.assertion_results);
  return result.lastInsertRowid as number;
}

export function findLogsByApiId(apiId: number, limit = 10): ApiLogRow[] {
  return db.prepare('SELECT * FROM api_logs WHERE api_id = ? ORDER BY executed_at DESC LIMIT ?').all(apiId, limit) as ApiLogRow[];
}

// ── 新执行日志表 ──

export interface ApiExecutionRow {
  id: number;
  api_id: number;
  scenario_log_id: number | null;
  scenario_id: number | null;
  node_id: string | null;
  param_row_index: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  batch_id: number;
}

export interface ApiExecutionStepRow {
  id: number;
  api_execution_id: number;
  step_order: number;
  log_type: string;
  step_name: string | null;
  log_text: string | null;
  log_data: string | null;
  created_at: string;
}

export function createApiExecution(data: {
  api_id: number;
  scenario_log_id?: number | null;
  scenario_id?: number | null;
  node_id?: string | null;
  param_row_index?: number;
  status: string;
  trigger_type?: string;
  executed_by?: string | null;
  request_headers?: string | null;
  request_body?: string | null;
  response_headers?: string | null;
  response_body?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  started_at: string;
  finished_at: string;
  batch_id?: number;
}): number {
  const result = db.prepare(
    `INSERT INTO api_executions (api_id, scenario_log_id, scenario_id, node_id, param_row_index, status, trigger_type, executed_by, request_headers, request_body, response_headers, response_body, duration_ms, error_message, started_at, finished_at, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.api_id,
    data.scenario_log_id ?? null,
    data.scenario_id ?? null,
    data.node_id ?? null,
    data.param_row_index ?? -1,
    data.status,
    data.trigger_type ?? 'manual',
    data.executed_by ?? null,
    data.request_headers ?? null,
    data.request_body ?? null,
    data.response_headers ?? null,
    data.response_body ?? null,
    data.duration_ms ?? null,
    data.error_message ?? null,
    data.started_at,
    data.finished_at,
    data.batch_id ?? -1
  );
  return result.lastInsertRowid as number;
}

export function createApiExecutionStep(data: {
  api_execution_id: number;
  step_order: number;
  log_type: string;
  step_name?: string | null;
  log_text?: string | null;
  log_data?: string | null | Record<string, unknown>;
  created_at: string;
}): number {
  const result = db.prepare(
    `INSERT INTO api_execution_steps (api_execution_id, step_order, log_type, step_name, log_text, log_data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.api_execution_id,
    data.step_order,
    data.log_type,
    data.step_name ?? null,
    data.log_text ?? null,
    data.log_data ? (typeof data.log_data === 'string' ? data.log_data : JSON.stringify(data.log_data)) : null,
    data.created_at
  );
  return result.lastInsertRowid as number;
}

export function findApiExecutionsByApiId(apiId: number, limit = 20): ApiExecutionRow[] {
  return db.prepare('SELECT * FROM api_executions WHERE api_id = ? ORDER BY started_at DESC LIMIT ?').all(apiId, limit) as ApiExecutionRow[];
}

export function findApiExecutionWithSteps(executionId: number): (ApiExecutionRow & { steps: ApiExecutionStepRow[] }) | null {
  const execution = db.prepare('SELECT * FROM api_executions WHERE id = ?').get(executionId) as ApiExecutionRow | undefined;
  if (!execution) return null;
  const steps = db.prepare('SELECT * FROM api_execution_steps WHERE api_execution_id = ? ORDER BY step_order').all(executionId) as ApiExecutionStepRow[];
  return { ...execution, steps };
}

export function findApiExecutionById(executionId: number): ApiExecutionRow | null {
  return db.prepare('SELECT * FROM api_executions WHERE id = ?').get(executionId) as ApiExecutionRow | null;
}

export function findBatchExecutions(batchId: number): ApiExecutionRow[] {
  return db.prepare('SELECT * FROM api_executions WHERE batch_id = ? ORDER BY param_row_index ASC').all(batchId) as ApiExecutionRow[];
}

export function updateApiExecution(id: number, data: {
  status?: string;
  request_headers?: string | null;
  request_body?: string | null;
  response_headers?: string | null;
  response_body?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  finished_at?: string;
  batch_id?: number;
}): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return false;
  values.push(id);
  const result = db.prepare(`UPDATE api_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}
