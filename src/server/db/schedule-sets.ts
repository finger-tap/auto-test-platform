import db from './index.js';

// ── ScheduleSet Row ────────────────────────────────────────

export interface ScheduleSetRow {
  id: number;
  scenario_set_id: number;
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
  scenario_set_name: string;
  scenario_set_description: string | null;
  scenario_count: number;
  creator_name: string;
}

// ── Ensure table exists ──────────────────────────────────────

const cols = db.prepare("PRAGMA table_info(schedule_sets)").all() as { name: string }[];
if (cols.length === 0) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_sets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_set_id INTEGER NOT NULL,
      cron_expr     TEXT,
      status        TEXT NOT NULL DEFAULT 'none',
      next_run_at   TEXT,
      last_run_at   TEXT,
      last_run_status TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (scenario_set_id) REFERENCES scenario_sets(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_schedule_sets_ssid ON schedule_sets(scenario_set_id);
    CREATE INDEX idx_schedule_sets_status ON schedule_sets(status, next_run_at);
  `);
} else {
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('last_run_at')) {
    db.exec("ALTER TABLE schedule_sets ADD COLUMN last_run_at TEXT");
  }
  if (!colNames.includes('last_run_status')) {
    db.exec("ALTER TABLE schedule_sets ADD COLUMN last_run_status TEXT");
  }
}

// ── Helpers ────────────────────────────────────────────────

export function computeNextRunFromCron(cronExpr: string | null): string | null {
  if (!cronExpr) return null;

  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length < 5) return null;

  const [minute, hour, day, month, dow] = fields.map(f => f.trim());
  const next = new Date();
  next.setSeconds(0, 0);

  for (let attempt = 0; attempt < 2880; attempt++) {
    next.setMinutes(next.getMinutes() + 1);

    if (!matchCronField(next.getMinutes(), minute)) continue;
    if (!matchCronField(next.getHours(), hour)) continue;
    if (!matchCronField(next.getDate(), day)) continue;
    if (!matchCronField(next.getMonth() + 1, month)) continue;
    if (!matchCronField(next.getDay(), dow)) continue;

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}:${pad(next.getSeconds())}`;
  }

  return null;
}

function matchCronField(value: number, pattern: string): boolean {
  if (pattern === '*') return true;
  for (const part of pattern.split(',')) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      if (value >= parseInt(rangeMatch[1]) && value <= parseInt(rangeMatch[2])) return true;
      continue;
    }
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      if (value % parseInt(stepMatch[1]) === 0) return true;
      continue;
    }
    if (parseInt(part) === value) return true;
  }
  return false;
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
      rs.name              AS scenario_set_name,
      rs.description       AS scenario_set_description,
      rs.scenario_ids      AS scenario_ids_str,
      COALESCE(u.nickname, u.account) AS creator_name
    FROM scenario_sets rs
    JOIN users u ON u.id = rs.user_id
    LEFT JOIN schedule_sets ss ON ss.scenario_set_id = rs.id
    WHERE rs.user_id = ?
    ORDER BY rs.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM scenario_sets WHERE user_id = ?'
  ).get(userId) as { count: number };

  const items = (rows as Record<string, unknown>[]).map((row) => {
    let cnt = 0;
    try {
      const ids = JSON.parse((row.scenario_ids_str as string) || '[]');
      cnt = Array.isArray(ids) ? ids.length : 0;
    } catch { cnt = 0; }
    return {
      id: row.schedule_set_id ?? 0,
      scenario_set_id: row.rs_id as number,
      cron_expr: row.cron_expr ?? null,
      status: (row.schedule_status ?? 'none') as 'none' | 'paused' | 'active',
      next_run_at: row.next_run_at ?? null,
      last_run_at: row.last_run_at ?? null,
      last_run_status: row.last_run_status ?? null,
      created_at: row.schedule_created_at ?? '',
      updated_at: row.schedule_updated_at ?? '',
      scenario_set_name: row.scenario_set_name,
      scenario_set_description: (row.scenario_set_description as string) ?? null,
      scenario_count: cnt,
      creator_name: row.creator_name,
    } as ScheduleSetItem;
  });

  return { items, total: count, page, pageSize };
}

export function findScheduleSetById(id: number): ScheduleSetRow | undefined {
  return db.prepare('SELECT * FROM schedule_sets WHERE id = ?').get(id) as ScheduleSetRow | undefined;
}

export function findScheduleSetByScenarioSetId(scenarioSetId: number): ScheduleSetRow | undefined {
  return db.prepare('SELECT * FROM schedule_sets WHERE scenario_set_id = ?').get(scenarioSetId) as ScheduleSetRow | undefined;
}

export function createScheduleSet(data: {
  scenario_set_id: number;
  cron_expr?: string | null;
  status?: 'none' | 'paused' | 'active';
  next_run_at?: string | null;
}): number {
  const result = db.prepare(
    `INSERT INTO schedule_sets (scenario_set_id, cron_expr, status, next_run_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.scenario_set_id,
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

  const result = db.prepare(`UPDATE schedule_sets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function upsertScheduleSet(
  scenarioSetId: number,
  cronExpr: string | null,
  status: 'none' | 'paused' | 'active',
  nextRunAt: string | null
): number {
  const existing = findScheduleSetByScenarioSetId(scenarioSetId);
  if (existing) {
    updateScheduleSet(existing.id, { cron_expr: cronExpr, status, next_run_at: nextRunAt });
    return existing.id;
  }
  return createScheduleSet({ scenario_set_id: scenarioSetId, cron_expr: cronExpr, status, next_run_at: nextRunAt });
}

export function deleteScheduleSet(id: number): boolean {
  const result = db.prepare('DELETE FROM schedule_sets WHERE id = ?').run(id);
  return result.changes > 0;
}

export function findActiveScheduleSets(): ScheduleSetRow[] {
  return db.prepare(`
    SELECT * FROM schedule_sets
    WHERE status = 'active' AND next_run_at IS NOT NULL
  `).all() as ScheduleSetRow[];
}