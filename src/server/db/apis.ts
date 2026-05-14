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
  executed_at: string;
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
}

export function findApisByUserId(userId: number): ApiRow[] {
  return db.prepare('SELECT * FROM apis WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ApiRow[];
}

export function findApiById(id: number): ApiRow | undefined {
  return db.prepare('SELECT * FROM apis WHERE id = ?').get(id) as ApiRow | undefined;
}

export function createApi(userId: number, data: CreateApiInput): number {
  const result = db.prepare(
    `INSERT INTO apis (user_id, name, method, url, protocol, headers, body, description, tags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, data.name, data.method, data.url, data.protocol || 'https', data.headers || null, data.body || null, data.description || null, data.tags || '', data.status || 'active');
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
}): number {
  const result = db.prepare(
    `INSERT INTO api_logs (api_id, status_code, response_headers, response_body, duration_ms)
     VALUES (?, ?, ?, ?, ?)`
  ).run(apiId, data.status_code, data.response_headers, data.response_body, data.duration_ms);
  return result.lastInsertRowid as number;
}

export function findLogsByApiId(apiId: number): ApiLogRow[] {
  return db.prepare('SELECT * FROM api_logs WHERE api_id = ? ORDER BY executed_at DESC').all(apiId) as ApiLogRow[];
}
