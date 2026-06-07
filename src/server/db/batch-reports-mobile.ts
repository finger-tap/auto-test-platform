import db from './index.js';

export interface BatchReportRow {
  id: number;
  set_id: number;
  report: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string | null;
  executed_at: string;
}

export interface BatchReportItem extends BatchReportRow {
  set_name: string;
}

const TABLE = 'batch_reports_mobile';

export function findBatchReportsByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number,
): { items: BatchReportItem[]; total: number } {
  const offset = (page - 1) * pageSize;
  const items = db
    .prepare(
      `SELECT br.*, ss.name AS set_name
       FROM ${TABLE} br
       JOIN case_sets_mobile ss ON ss.id = br.set_id
       WHERE ss.user_id = ?
       ORDER BY br.executed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, pageSize, offset) as BatchReportItem[];
  const { count } = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ${TABLE} br
       JOIN case_sets_mobile ss ON ss.id = br.set_id
       WHERE ss.user_id = ?`,
    )
    .get(userId) as { count: number };
  return { items, total: count };
}

export function findBatchReportById(id: number): BatchReportItem | undefined {
  return db
    .prepare(
      `SELECT br.*, ss.name AS set_name
       FROM ${TABLE} br
       JOIN case_sets_mobile ss ON ss.id = br.set_id
       WHERE br.id = ?`,
    )
    .get(id) as BatchReportItem | undefined;
}

export function createBatchReport(data: {
  setId: number;
  report: string;
  passed?: number;
  failed?: number;
  totalDurationMs?: number;
  executedBy?: string;
}): number {
  const result = db
    .prepare(
      `INSERT INTO ${TABLE}
        (set_id, report, passed, failed, total_duration_ms, executed_by, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
    )
    .run(
      data.setId,
      data.report,
      data.passed ?? 0,
      data.failed ?? 0,
      data.totalDurationMs ?? 0,
      data.executedBy ?? null,
    );
  return result.lastInsertRowid as number;
}

export function updateBatchReport(
  id: number,
  data: Partial<{
    setId: number;
    report: string;
    passed: number;
    failed: number;
    totalDurationMs: number;
    executedBy: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (data.setId !== undefined) { fields.push('set_id = ?'); vals.push(data.setId); }
  if (data.report !== undefined) { fields.push('report = ?'); vals.push(data.report); }
  if (data.passed !== undefined) { fields.push('passed = ?'); vals.push(data.passed); }
  if (data.failed !== undefined) { fields.push('failed = ?'); vals.push(data.failed); }
  if (data.totalDurationMs !== undefined) { fields.push('total_duration_ms = ?'); vals.push(data.totalDurationMs); }
  if (data.executedBy !== undefined) { fields.push('executed_by = ?'); vals.push(data.executedBy); }

  if (fields.length === 0) return false;

  vals.push(id);
  const result = db
    .prepare(`UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`)
    .run(...vals);
  return result.changes > 0;
}

export function deleteBatchReport(id: number): boolean {
  const result = db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
  return result.changes > 0;
}
