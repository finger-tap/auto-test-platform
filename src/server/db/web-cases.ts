import db from './index.js';

export interface WebCaseRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string | null;
  status: string;
  steps: string | null;        // JSON array of NL step objects
  check_points: string | null; // JSON array of check point objects
  data_drive: string | null;   // JSON array of CSV data
  preconditions: string | null; // JSON array of precondition objects
  browser: string | null;
  window_size: string | null;
  timeout: number | null;
  headless_mode: number | null;
  base_url: string | null;
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
  steps?: string; // JSON string
  check_points?: string; // JSON string
  data_drive?: string; // JSON string
  preconditions?: string; // JSON string
  browser?: string;
  window_size?: string;
  timeout?: number;
  headless_mode?: number;
  base_url?: string;
}

export interface UpdateWebCaseInput {
  name?: string;
  description?: string;
  tags?: string;
  status?: string;
  steps?: string; // JSON string
  check_points?: string; // JSON string
  data_drive?: string; // JSON string
  preconditions?: string; // JSON string
  browser?: string;
  window_size?: string;
  timeout?: number;
  headless_mode?: number;
  base_url?: string;
}

interface ListFilter {
  name?: string;
  status?: string;
  tag?: string;
}

export function listWebCases(
  userId: number,
  page: number,
  pageSize: number,
  sortField: string,
  sortOrder: string,
  filters: ListFilter
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
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  if (filters.tag) {
    conditions.push('tags LIKE ?');
    values.push(`%${filters.tag}%`);
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
    `INSERT INTO web_test_cases (user_id, name, description, tags, status, steps, check_points, data_drive, preconditions, browser, window_size, timeout, headless_mode, base_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`
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
    data.base_url || null
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