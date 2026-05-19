import db from './index.js';

export interface BatchReportRow {
  id: number;
  set_id: number;
  set_name: string;
  report: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string;
  executed_at: string;
}

/**
 * Get all batch reports for a user across all scenario sets.
 * Used by the global batch reports page.
 */
export function findAllBatchReportsByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number
): { items: BatchReportRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const items = db.prepare(`
    SELECT br.id, br.set_id, ss.name AS set_name,
           br.report, br.passed, br.failed, br.total_duration_ms,
           br.executed_by, br.executed_at
    FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ss.user_id = ?
    ORDER BY br.executed_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset) as BatchReportRow[];

  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ss.user_id = ?
  `).get(userId) as { count: number };

  return { items, total: count };
}

/**
 * Get a single batch report by id with full scenario details.
 */
export function findBatchReportById(reportId: number, userId: number): BatchReportRow | undefined {
  return db.prepare(`
    SELECT br.id, br.set_id, ss.name AS set_name,
           br.report, br.passed, br.failed, br.total_duration_ms,
           br.executed_by, br.executed_at
    FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE br.id = ? AND ss.user_id = ?
  `).get(reportId, userId) as BatchReportRow | undefined;
}