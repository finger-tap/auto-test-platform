/**
 * schedule_sets_mobile — 调度 移动端 用例集
 * 表名 schedule_sets_mobile;FK 指向 case_sets_mobile(id)
 */

import db from './index.js';
import { computeNextRunFromCron } from './schedule-sets-api.js';

export interface ScheduleSetRow {
  id: number;
  case_set_id: number;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

// Full detail returned to frontend
export interface ScheduleSetItem extends ScheduleSetRow {
  case_set_name: string;
  case_set_description: string | null;
  case_count: number;
  creator_name: string;
}

// ── CRUD ────────────────────────────────────────────────────

export function findScheduleSetsByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number
): { items: ScheduleSetItem[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(`
    SELECT
      ss.id                AS schedule_set_id,
      ss.cron_expr,
      ss.status            AS schedule_status,
      ss.next_run_at,
      ss.last_run_at,
      ss.last_run_status,
      ss.created_at        AS schedule_created_at,
      ss.updated_at        AS schedule_updated_at,
      rs.id                AS rs_id,
      rs.name              AS case_set_name,
      rs.description       AS case_set_description,
      rs.test_case_ids     AS test_case_ids_str,
      COALESCE(u.nickname, u.account) AS creator_name
    FROM case_sets_mobile rs
    JOIN users u ON u.id = rs.user_id
    LEFT JOIN schedule_sets_mobile ss ON ss.case_set_id = rs.id
    WHERE rs.user_id = ?
    ORDER BY rs.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM case_sets_mobile WHERE user_id = ?'
  ).get(userId) as { count: number };

  const items = (rows as Record<string, unknown>[]).map((row) => {
    let cnt = 0;
    try {
      const ids = JSON.parse((row.test_case_ids_str as string) || '[]');
      cnt = Array.isArray(ids) ? ids.length : 0;
    } catch { cnt = 0; }
    return {
      id: row.schedule_set_id ?? 0,
      case_set_id: row.rs_id as number,
      cron_expr: row.cron_expr ?? null,
      status: (row.schedule_status ?? 'none') as 'none' | 'paused' | 'active',
      next_run_at: row.next_run_at ?? null,
      last_run_at: row.last_run_at ?? null,
      last_run_status: row.last_run_status ?? null,
      created_at: row.schedule_created_at ?? '',
      updated_at: row.schedule_updated_at ?? '',
      case_set_name: row.case_set_name,
      case_set_description: (row.case_set_description as string) ?? null,
      case_count: cnt,
      creator_name: row.creator_name,
    } as ScheduleSetItem;
  });

  return { items, total: count, page, pageSize };
}

export function findScheduleSetById(id: number): ScheduleSetRow | undefined {
  return db.prepare('SELECT * FROM schedule_sets_mobile WHERE id = ?').get(id) as ScheduleSetRow | undefined;
}

export function findScheduleSetByCaseSetId(caseSetId: number): ScheduleSetRow | undefined {
  return db.prepare('SELECT * FROM schedule_sets_mobile WHERE case_set_id = ?').get(caseSetId) as ScheduleSetRow | undefined;
}

export function createScheduleSet(data: {
  case_set_id: number;
  cron_expr?: string | null;
  status?: 'none' | 'paused' | 'active';
  next_run_at?: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO schedule_sets_mobile (case_set_id, cron_expr, status, next_run_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.case_set_id,
    data.cron_expr ?? null,
    data.status ?? 'none',
    data.next_run_at ?? null
  );
  return result.lastInsertRowid as number;
}

export function updateScheduleSet(
  id: number,
  data: {
    cron_expr?: string | null;
    status?: 'none' | 'paused' | 'active';
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
  }
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id);

  const result = db.prepare(`UPDATE schedule_sets_mobile SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function upsertScheduleSet(
  caseSetId: number,
  cronExpr: string | null,
  status: 'none' | 'paused' | 'active',
  nextRunAt: string | null
): number {
  const existing = findScheduleSetByCaseSetId(caseSetId);
  if (existing) {
    updateScheduleSet(existing.id, { cron_expr: cronExpr, status, next_run_at: nextRunAt });
    return existing.id;
  }
  return createScheduleSet({ case_set_id: caseSetId, cron_expr: cronExpr, status, next_run_at: nextRunAt });
}

export function deleteScheduleSet(id: number): boolean {
  const result = db.prepare('DELETE FROM schedule_sets_mobile WHERE id = ?').run(id);
  return result.changes > 0;
}

export function findActiveScheduleSets(): ScheduleSetRow[] {
  return db.prepare(`
    SELECT * FROM schedule_sets_mobile
    WHERE status = 'active' AND next_run_at IS NOT NULL
  `).all() as ScheduleSetRow[];
}

export { computeNextRunFromCron };
