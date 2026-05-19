import db from './index.js';
import type { BatchLogRow, BatchReport } from '../engine/batch-executor.js';

export function saveBatchReport(report: BatchReport): number {
  const result = db.prepare(
    `INSERT INTO batch_reports (set_id, report, passed, failed, total_duration_ms, executed_by, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    report.set_id,
    JSON.stringify(report),
    report.passed,
    report.failed,
    report.total_duration_ms,
    report.executed_by,
    report.executed_at
  );
  return result.lastInsertRowid as number;
}

export function findReportsBySetId(setId: number, limit = 20): BatchLogRow[] {
  return db.prepare(
    'SELECT * FROM batch_reports WHERE set_id = ? ORDER BY executed_at DESC LIMIT ?'
  ).all(setId, limit) as BatchLogRow[];
}

export function findReportsByUserIdPaginated(userId: number, page = 1, pageSize = 10): { items: Array<{ id: number; set_id: number; set_name: string; passed: number; failed: number; total_duration_ms: number; executed_by: string; executed_at: string; report: string }>; total: number } {
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT br.id, br.set_id, ss.name AS set_name, br.passed, br.failed, br.total_duration_ms, br.executed_by, br.executed_at, br.report
    FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ss.user_id = ?
    ORDER BY br.executed_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM batch_reports br
    JOIN scenario_sets ss ON ss.id = br.set_id
    WHERE ss.user_id = ?
  `).get(userId) as { count: number };
  return { items: rows as Array<{ id: number; set_id: number; set_name: string; passed: number; failed: number; total_duration_ms: number; executed_by: string; executed_at: string; report: string }>, total: count };
}