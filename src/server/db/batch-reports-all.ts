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
  pageSize: number,
  testType?: string
): { items: BatchReportRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = ['ss.user_id = ?'];
  const params: (string | number)[] = [userId];
  if (testType) { conditions.push('br.test_type = ?'); params.push(testType); }
  const where = conditions.join(' AND ');
  const items = db.prepare(`
    SELECT br.id, br.set_id, ss.name AS set_name,
           br.report, br.passed, br.failed, br.total_duration_ms,
           br.executed_by, br.executed_at
    FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ${where}
    ORDER BY br.executed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as BatchReportRow[];

  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ${where}
  `).get(...params) as { count: number };

  return { items, total: count };
}

/**
 * Get a single batch report by id with full scenario details.
 */
export function findBatchReportById(reportId: number, userId: number, testType?: string): BatchReportRow | undefined {
  if (testType) {
    return db.prepare(`
      SELECT br.id, br.set_id, ss.name AS set_name,
             br.report, br.passed, br.failed, br.total_duration_ms,
             br.executed_by, br.executed_at
      FROM batch_reports br
      JOIN scenario_sets ss ON ss.id = br.set_id
      WHERE br.id = ? AND ss.user_id = ? AND br.test_type = ?
    `).get(reportId, userId, testType) as BatchReportRow | undefined;
  }
  return db.prepare(`
    SELECT br.id, br.set_id, ss.name AS set_name,
           br.report, br.passed, br.failed, br.total_duration_ms,
           br.executed_by, br.executed_at
    FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE br.id = ? AND ss.user_id = ?
  `).get(reportId, userId) as BatchReportRow | undefined;
}