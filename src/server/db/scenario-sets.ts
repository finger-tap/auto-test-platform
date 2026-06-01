import db from './index.js';

export interface ScenarioSetRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string; // comma separated
  status: string; // active, disabled, draft
  scenario_ids: string; // JSON array of scenario IDs
  created_at: string;
  updated_at: string;
}

export interface ScenarioSetItem extends ScenarioSetRow {
  scenario_count: number;
  execution_summary?: {
    total: number;
    passed: number;
    failed: number;
    last_executed_at: string;
  } | null;
}

export function findSetsByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number,
  filters: { name?: string; tags?: string; status?: string } = {},
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

    // Aggregate each scenario's latest execution result across all batches
    const allItems = db.prepare(`
      SELECT sei.scenario_id, sei.status, sse.started_at
      FROM scenario_set_execution_items sei
      JOIN scenario_set_executions sse ON sei.set_execution_id = sse.id
      WHERE sse.set_id = ?
      ORDER BY sse.started_at DESC
    `).all(r.id) as { scenario_id: number; status: string; started_at: string }[];

    const latestByScenario = new Map<number, string>();
    let lastExecutedAt = '';
    for (const item of allItems) {
      if (!latestByScenario.has(item.scenario_id)) {
        latestByScenario.set(item.scenario_id, item.status);
      }
      if (!lastExecutedAt) lastExecutedAt = item.started_at;
    }

    let passed = 0;
    let failed = 0;
    for (const status of latestByScenario.values()) {
      if (status === 'success') passed++;
      else failed++;
    }

    return {
      ...r,
      scenario_count: cnt,
      execution_summary: cnt > 0 ? {
        total: cnt,
        passed,
        failed,
        last_executed_at: lastExecutedAt,
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

export function createSet(userId: number, name: string, description?: string, scenarioIds?: number[], tags?: string, status?: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO scenario_sets (user_id, name, description, scenario_ids, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, name, description || null,
    JSON.stringify(scenarioIds || []),
    tags || '', status || 'draft',
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
}): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); vals.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); vals.push(data.description); }
  if (data.tags !== undefined) { fields.push('tags = ?'); vals.push(data.tags); }
  if (data.status !== undefined) { fields.push('status = ?'); vals.push(data.status); }
  if (data.scenario_ids !== undefined) { fields.push('scenario_ids = ?'); vals.push(JSON.stringify(data.scenario_ids)); }

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