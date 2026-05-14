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
  created_at: string;
  updated_at: string;
}

export interface ApiLogRow {
  id: number;
  api_id: number;
  status_code: number | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: string | null;
  executed_at: string;
}

export interface AssertionRule {
  source: 'status' | 'header' | 'body';
  key: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;
}

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
}

export function findApisByUserId(userId: number): ApiRow[] {
  return db.prepare('SELECT * FROM apis WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ApiRow[];
}

export function findApiById(id: number): ApiRow | undefined {
  return db.prepare('SELECT * FROM apis WHERE id = ?').get(id) as ApiRow | undefined;
}

export function createApi(userId: number, data: CreateApiInput): number {
  const result = db.prepare(
    `INSERT INTO apis (user_id, name, method, url, protocol, headers, body, description, tags, status, content_type, assertions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, data.name, data.method, data.url, data.protocol || 'https', data.headers || null, data.body || null, data.description || null, data.tags || '', data.status || 'active', data.content_type || 'json', data.assertions || null);
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

  fields.push("updated_at = datetime('now')");
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
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO api_logs (api_id, status_code, response_headers, response_body, duration_ms, executed_by, assertion_results)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(apiId, data.status_code, data.response_headers, data.response_body, data.duration_ms, data.executed_by, data.assertion_results);
  return result.lastInsertRowid as number;
}

export function findLogsByApiId(apiId: number, limit = 10): ApiLogRow[] {
  return db.prepare('SELECT * FROM api_logs WHERE api_id = ? ORDER BY executed_at DESC LIMIT ?').all(apiId, limit) as ApiLogRow[];
}
