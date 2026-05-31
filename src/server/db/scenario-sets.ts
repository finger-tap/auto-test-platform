import db from './index.js';

export interface ScenarioSetRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string; // comma separated
  status: string; // active, disabled, draft
  scenario_ids: string; // JSON array of scenario IDs
  test_type: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioSetItem extends ScenarioSetRow {
  scenario_count: number;
  last_execution?: {
    status: string;
    passed_count: number;
    failed_count: number;
    total_duration_ms: number;
    executed_at: string;
  } | null;
}

export function findSetsByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number,
  filters: { name?: string; tags?: string; status?: string; test_type?: string } = {},
  sort = 'updated_at',
  order = 'DESC'
): { items: ScenarioSetItem[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const conditions: string[] = ['user_id = ?'];
  const params: (string | number)[] = [userId];

  if (filters.name) { conditions.push('name LIKE ?'); params.push(`%${filters.name}%`); }
  if (filters.tags) { conditions.push('tags LIKE ?'); params.push(`%${filters.tags}%`); }
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.test_type) { conditions.push('test_type = ?'); params.push(filters.test_type); }

  const where = conditions.join(' AND ');
  const rows = db.prepare(
    `SELECT * FROM scenario_sets WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as ScenarioSetRow[];

  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM scenario_sets WHERE ${where}`
  ).get(...params) as { count: number };

  const items = rows.map(r => {
    let cnt = 0;
    try { const ids = JSON.parse(r.scenario_ids || '[]'); cnt = Array.isArray(ids) ? ids.length : 0; } catch { cnt = 0; }

    // Fetch latest execution for this set
    const lastExec = db.prepare(
      'SELECT status, passed_count, failed_count, total_duration_ms, finished_at FROM scenario_set_executions WHERE set_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(r.id) as { status: string; passed_count: number; failed_count: number; total_duration_ms: number; finished_at: string } | undefined;

    return {
      ...r,
      scenario_count: cnt,
      last_execution: lastExec ? {
        status: lastExec.status,
        passed_count: lastExec.passed_count,
        failed_count: lastExec.failed_count,
        total_duration_ms: lastExec.total_duration_ms,
        executed_at: lastExec.finished_at,
      } : null,
    };
  });
  return { items, total: count, page, pageSize };
}

export function findSetsByUserId(userId: number): ScenarioSetItem[] {
  const rows = db.prepare('SELECT * FROM scenario_sets WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ScenarioSetRow[];
  return rows.map((r) => {
    let count = 0;
    try {
      const ids = JSON.parse(r.scenario_ids || '[]');
      count = Array.isArray(ids) ? ids.length : 0;
    } catch { count = 0; }
    return { ...r, scenario_count: count };
  });
}

export function findSetById(id: number): ScenarioSetRow | undefined {
  return db.prepare('SELECT * FROM scenario_sets WHERE id = ?').get(id) as ScenarioSetRow | undefined;
}

export function createSet(userId: number, name: string, description?: string, scenarioIds?: number[], tags?: string, status?: string, testType?: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO scenario_sets (user_id, name, description, scenario_ids, tags, status, test_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, name, description || null,
    JSON.stringify(scenarioIds || []),
    tags || '', status || 'draft',
    testType || 'api',
    now, now
  );
  return result.lastInsertRowid as number;
}

export function updateSet(id: number, userId: number, data: {
  name?: string;
  description?: string | null;
  tags?: string;
  status?: string;
  scenario_ids?: number[];
  test_type?: string;
}): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); vals.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); vals.push(data.description); }
  if (data.tags !== undefined) { fields.push('tags = ?'); vals.push(data.tags); }
  if (data.status !== undefined) { fields.push('status = ?'); vals.push(data.status); }
  if (data.scenario_ids !== undefined) { fields.push('scenario_ids = ?'); vals.push(JSON.stringify(data.scenario_ids)); }
  if (data.test_type !== undefined) { fields.push('test_type = ?'); vals.push(data.test_type); }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  vals.push(id, userId);

  const result = db.prepare(`UPDATE scenario_sets SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
  return result.changes > 0;
}

export function deleteSet(id: number, userId: number): boolean {
  const result = db.prepare('DELETE FROM scenario_sets WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}