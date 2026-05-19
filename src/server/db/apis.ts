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
  source: 'status' | 'header' | 'body';
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
}

export function findApisByUserIdPaginated(userId: number, page: number, pageSize: number, sort = 'updated_at', order = 'DESC'): { items: ApiRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const items = db.prepare(`SELECT * FROM apis WHERE user_id = ? ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(userId, pageSize, offset) as ApiRow[];
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM apis WHERE user_id = ?').get(userId) as { count: number };
  return { items, total: count };
}

export function findApisByUserId(userId: number): ApiRow[] {
  return db.prepare('SELECT * FROM apis WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ApiRow[];
}

export function findApiById(id: number): ApiRow | undefined {
  return db.prepare('SELECT * FROM apis WHERE id = ?').get(id) as ApiRow | undefined;
}

export function createApi(userId: number, data: CreateApiInput): number {
  const result = db.prepare(
    `INSERT INTO apis (user_id, name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
  ).run(userId, data.name, data.method, data.url, data.protocol || 'https', data.headers || null, data.body || null, data.description || null, data.tags || '', data.status || 'active', data.content_type || 'json', data.assertions || null, data.pre_script || null, data.post_script || null, data.pre_db_name || null, data.pre_db_query || null, data.post_db_name || null, data.post_db_query || null, data.pre_assertions || null, data.post_assertions || null, data.final_assertions || null, data.ws_send || null, data.ws_expect || null);
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
