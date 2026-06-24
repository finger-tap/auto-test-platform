import db from './index.js';

export interface CaseSetRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  test_case_ids: string;
  created_at: string;
  updated_at: string;
}

export interface CaseSetItem extends CaseSetRow {
  case_count: number;
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
  filters: { name?: string; tags?: string; status?: string; dateFrom?: string; dateTo?: string } = {},
  sort = 'updated_at',
  order = 'DESC'
): { items: CaseSetItem[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const conditions: string[] = ['user_id = ?'];
  const params: (string | number)[] = [userId];

  if (filters.name) { conditions.push('name LIKE ?'); params.push(`%${filters.name}%`); }
  if (filters.tags) { conditions.push('tags LIKE ?'); params.push(`%${filters.tags}%`); }
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.dateFrom) { conditions.push('created_at >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push('created_at <= ?'); params.push(filters.dateTo + 'T23:59:59'); }

  const where = conditions.join(' AND ');
  const rows = db.prepare(
    `SELECT * FROM case_sets_web WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as CaseSetRow[];

  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM case_sets_web WHERE ${where}`
  ).get(...params) as { count: number };

  // 2026-06-06: execution_summary — per-case latest status across ALL batches.
  // Same pattern as scenario-sets.ts:findSetsByUserIdPaginated. The list UI
  // (CaseSetList.tsx) shows three-color counts + last executed time, no
  // report link (drill into the detail page to open individual reports).
  //
  // 2026-06-06 (#40 fix): defense against data corruption. An older client
  // version could send test_case_ids as ["[","]",9] (bracket chars as
  // elements). The old code did `ids.length` as the case count, which
  // produced wrong "未执行" numbers (3 instead of 1). Fix: filter to numeric
  // IDs only before counting. Also limit the JOIN aggregation to case_ids
  // in the CURRENT set so historical items for removed cases don't leak
  // into the latestByCase map.
  const items = rows.map(r => {
    let caseIdSet = new Set<number>();
    try {
      const ids = JSON.parse(r.test_case_ids || '[]');
      if (Array.isArray(ids)) {
        for (const v of ids) {
          if (typeof v === 'number' && Number.isFinite(v)) caseIdSet.add(v);
          // Also accept numeric strings (e.g. "9") — older clients may stringify.
          else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
            caseIdSet.add(Number(v));
          }
        }
      }
    } catch { caseIdSet = new Set(); }
    const cnt = caseIdSet.size;

    const allItems = db.prepare(`
      SELECT sei.case_id, sei.status, sse.started_at
      FROM case_set_execution_items_web sei
      JOIN case_set_executions_web sse ON sei.set_execution_id = sse.id
      WHERE sse.set_id = ?
      ORDER BY sse.started_at DESC
    `).all(r.id) as { case_id: number; status: string; started_at: string }[];

    const latestByCase = new Map<number, string>();
    let lastExecutedAt = '';
    for (const item of allItems) {
      // Only count items whose case_id is in the CURRENT set membership.
      // If the user removed a case after some executions, those historical
      // rows are skipped (they're "phantom" — no longer part of the set).
      if (caseIdSet.size > 0 && !caseIdSet.has(item.case_id)) continue;
      if (!latestByCase.has(item.case_id)) {
        latestByCase.set(item.case_id, item.status);
      }
      if (!lastExecutedAt) lastExecutedAt = item.started_at;
    }

    let passed = 0;
    let failed = 0;
    for (const status of latestByCase.values()) {
      if (status === 'success') passed++;
      else failed++;
    }

    return {
      ...r,
      case_count: cnt,
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

export function findSetsByUserId(userId: number): CaseSetItem[] {
  const rows = db.prepare('SELECT * FROM case_sets_web WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as CaseSetRow[];
  return rows.map((r) => {
    let count = 0;
    try {
      const ids = JSON.parse(r.test_case_ids || '[]');
      count = Array.isArray(ids) ? ids.length : 0;
    } catch { count = 0; }
    return { ...r, case_count: count };
  });
}

export function findSetById(id: number): CaseSetRow | undefined {
  return db.prepare('SELECT * FROM case_sets_web WHERE id = ?').get(id) as CaseSetRow | undefined;
}

export function createSet(userId: number, name: string, description?: string, testCaseIds?: number[], tags?: string, status?: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO case_sets_web (user_id, name, description, test_case_ids, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, name, description || null,
    JSON.stringify(testCaseIds || []),
    tags || '', status || 'active',
    now, now
  );
  return result.lastInsertRowid as number;
}

export function updateSet(id: number, userId: number, data: {
  name?: string;
  description?: string | null;
  tags?: string;
  status?: string;
  test_case_ids?: number[];
}): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); vals.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); vals.push(data.description); }
  if (data.tags !== undefined) { fields.push('tags = ?'); vals.push(data.tags); }
  if (data.status !== undefined) { fields.push('status = ?'); vals.push(data.status); }
  if (data.test_case_ids !== undefined) { fields.push('test_case_ids = ?'); vals.push(JSON.stringify(data.test_case_ids)); }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  vals.push(id, userId);

  const result = db.prepare(`UPDATE case_sets_web SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
  return result.changes > 0;
}

export function deleteSet(id: number, userId: number): boolean {
  const result = db.prepare('DELETE FROM case_sets_web WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

// ── Case set executions ──

export interface CaseSetExecutionRow {
  id: number;
  set_id: number;
  status: 'running' | 'success' | 'failed';
  trigger_type: string;
  executed_by: string | null;
  total_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  total_duration_ms: number | null;
  started_at: string;
  finished_at: string;
}

export interface CaseSetExecutionItemRow {
  id: number;
  set_execution_id: number;
  case_id: number;
  case_name: string | null;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  duration_ms: number | null;
  error_message: string | null;
  case_execution_id: number | null;
  report_path: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export function createCaseSetExecution(setId: number, triggerType: string, executedBy: string, startedAt: string): number {
  const result = db.prepare(
    `INSERT INTO case_set_executions_web (set_id, status, trigger_type, executed_by, started_at, finished_at)
     VALUES (?, 'running', ?, ?, ?, '')`
  ).run(setId, triggerType, executedBy, startedAt);
  return result.lastInsertRowid as number;
}

export function updateCaseSetExecution(id: number, patch: {
  status?: 'running' | 'success' | 'failed';
  total_count?: number;
  passed_count?: number;
  failed_count?: number;
  skipped_count?: number;
  total_duration_ms?: number | null;
  finished_at?: string;
}): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      vals.push(value);
    }
  }
  if (fields.length === 0) return false;
  vals.push(id);
  const result = db.prepare(`UPDATE case_set_executions_web SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return result.changes > 0;
}

export function findCaseSetExecutions(setId: number): CaseSetExecutionRow[] {
  return db.prepare(
    `SELECT * FROM case_set_executions_web WHERE set_id = ? ORDER BY started_at DESC`
  ).all(setId) as CaseSetExecutionRow[];
}

export function findCaseSetExecutionById(id: number): CaseSetExecutionRow | undefined {
  return db.prepare('SELECT * FROM case_set_executions_web WHERE id = ?').get(id) as CaseSetExecutionRow | undefined;
}

export function createCaseSetExecutionItem(setExecutionId: number, caseId: number, caseName: string): number {
  const result = db.prepare(
    `INSERT INTO case_set_execution_items_web (set_execution_id, case_id, case_name, status, started_at, finished_at)
     VALUES (?, ?, ?, 'running', datetime('now', '+8 hours'), '')`
  ).run(setExecutionId, caseId, caseName);
  return result.lastInsertRowid as number;
}

export function updateCaseSetExecutionItem(id: number, patch: {
  status?: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  duration_ms?: number | null;
  error_message?: string | null;
  case_execution_id?: number | null;
  report_path?: string | null;
  finished_at?: string;
}): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      vals.push(value);
    }
  }
  if (fields.length === 0) return false;
  vals.push(id);
  const result = db.prepare(`UPDATE case_set_execution_items_web SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return result.changes > 0;
}

export function findCaseSetExecutionItems(setExecutionId: number): CaseSetExecutionItemRow[] {
  return db.prepare(
    `SELECT * FROM case_set_execution_items_web WHERE set_execution_id = ? ORDER BY id`
  ).all(setExecutionId) as CaseSetExecutionItemRow[];
}
