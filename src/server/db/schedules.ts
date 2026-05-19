import db from './index.js';

// ── Schedule interfaces ──

export interface ScheduleRow {
  id: number;
  scenario_id: number;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

// Schedule with scenario and user info (for frontend list)
export interface ScheduleWithDetails extends ScheduleRow {
  scenario_name: string;
  scenario_description: string | null;
  creator_name: string;
}

export interface CreateScheduleInput {
  scenario_id: number;
  cron_expr?: string | null;
  status?: 'none' | 'paused' | 'active';
  next_run_at?: string | null;
}

export interface UpdateScheduleInput {
  cron_expr?: string | null;
  status?: 'none' | 'paused' | 'active';
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_run_status?: string | null;
}

// ── Schedule table migration ──

const schedCols = db.prepare("PRAGMA table_info(schedules)").all() as { name: string }[];
if (schedCols.length === 0) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      cron_expr TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      next_run_at TEXT,
      last_run_at TEXT,
      last_run_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_scenario_id ON schedules(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_status_next_run ON schedules(status, next_run_at);
  `);
} else {
  // Ensure new columns exist (for existing databases)
  const colNames = schedCols.map(c => c.name);
  if (!colNames.includes('last_run_at')) {
    db.exec("ALTER TABLE schedules ADD COLUMN last_run_at TEXT");
  }
  if (!colNames.includes('last_run_status')) {
    db.exec("ALTER TABLE schedules ADD COLUMN last_run_status TEXT");
  }
}

// ── Schedule CRUD ──

export function findSchedulesByUserIdPaginated(
  userId: number, page: number, pageSize: number,
  creator?: string, sort = 'updated_at', order = 'DESC'
): { items: ScheduleWithDetails[]; total: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'sc.updated_at', created_at: 'sc.created_at', name: 'sc.name' };
  const sortCol = validSorts[sort] || 'sc.updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const conditions: string[] = ['sc.user_id = ?'];
  const params: (string | number)[] = [userId];
  if (creator) { conditions.push("(COALESCE(u.nickname, u.account) LIKE ? OR u.account LIKE ?)"); params.push(`%${creator}%`, `%${creator}%`); }
  const where = conditions.join(' AND ');
  const rawRows = db.prepare(`
    SELECT
      sc.id               AS scenario_id,
      s.id                AS schedule_id,
      s.cron_expr,
      s.status            AS schedule_status,
      s.next_run_at,
      s.last_run_at,
      s.last_run_status,
      s.created_at        AS schedule_created_at,
      s.updated_at        AS schedule_updated_at,
      sc.name             AS scenario_name,
      sc.description      AS scenario_description,
      COALESCE(u.nickname, u.account) AS creator_name
    FROM scenarios sc
    JOIN users u ON u.id = sc.user_id
    LEFT JOIN schedules s ON s.scenario_id = sc.id
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Record<string, unknown>[];
  const countParams = creator ? [userId, `%${creator}%`, `%${creator}%`] : [userId];
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM scenarios sc JOIN users u ON u.id = sc.user_id WHERE ${where}`).get(...countParams) as { count: number };
  return {
    items: rawRows.map((row) => ({
      id:                 row.schedule_id ?? 0,
      scenario_id:        row.scenario_id as number,
      cron_expr:          row.cron_expr ?? null,
      status:             row.schedule_status ?? 'none',
      next_run_at:        row.next_run_at ?? null,
      last_run_at:        row.last_run_at ?? null,
      last_run_status:    row.last_run_status ?? null,
      created_at:         (row.schedule_created_at as string) || '',
      updated_at:         (row.schedule_updated_at as string) || '',
      scenario_name:      row.scenario_name as string,
      scenario_description: (row.scenario_description as string) ?? null,
      creator_name:       row.creator_name as string,
    })) as unknown as ScheduleWithDetails[],
    total: count,
  };
}

export function findSchedulesByUserId(userId: number): ScheduleWithDetails[] {
  // List ALL scenarios for the user, LEFT JOIN schedules to get schedule info
  // Scenarios without a schedule record show status = 'none'
  const rawRows2 = db.prepare(`
    SELECT
      sc.id               AS scenario_id,
      s.id                AS schedule_id,
      s.cron_expr,
      s.status            AS schedule_status,
      s.next_run_at,
      s.last_run_at,
      s.last_run_status,
      s.created_at        AS schedule_created_at,
      s.updated_at        AS schedule_updated_at,
      sc.name             AS scenario_name,
      sc.description      AS scenario_description,
      COALESCE(u.nickname, u.account) AS creator_name
    FROM scenarios sc
    JOIN users u ON u.id = sc.user_id
    LEFT JOIN schedules s ON s.scenario_id = sc.id
    WHERE sc.user_id = ?
    ORDER BY sc.updated_at DESC
  `).all(userId) as Record<string, unknown>[];
  return (rawRows2 as Record<string, unknown>[]).map((row) => ({
    // Map to ScheduleWithDetails (flatten schedule columns)
    id:                 row.schedule_id ?? 0,
    scenario_id:        row.scenario_id as number,
    cron_expr:          row.cron_expr ?? null,
    status:             row.schedule_status ?? 'none',
    next_run_at:        row.next_run_at ?? null,
    last_run_at:        row.last_run_at ?? null,
    last_run_status:    row.last_run_status ?? null,
    created_at:         row.schedule_created_at ?? row.scenario_created_at ?? '',
    updated_at:         row.schedule_updated_at ?? '',
    scenario_name:      row.scenario_name,
    scenario_description: row.scenario_description ?? null,
    creator_name:       row.creator_name,
  })) as unknown as ScheduleWithDetails[];
}

export function findScheduleById(id: number): ScheduleRow | undefined {
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
}

export function findScheduleByScenarioId(scenarioId: number): ScheduleRow | undefined {
  return db.prepare('SELECT * FROM schedules WHERE scenario_id = ?').get(scenarioId) as ScheduleRow | undefined;
}

export function createSchedule(data: CreateScheduleInput): number {
  const result = db.prepare(
    `INSERT INTO schedules (scenario_id, cron_expr, status, next_run_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.scenario_id,
    data.cron_expr || null,
    data.status || 'none',
    data.next_run_at || null
  );
  return result.lastInsertRowid as number;
}

export function updateSchedule(id: number, data: UpdateScheduleInput): boolean {
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

  const result = db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteSchedule(id: number): boolean {
  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  return result.changes > 0;
}

export function upsertSchedule(scenarioId: number, cronExpr: string | null, status: 'none' | 'paused' | 'active', nextRunAt: string | null): number {
  const existing = findScheduleByScenarioId(scenarioId);
  if (existing) {
    updateSchedule(existing.id, { cron_expr: cronExpr, status, next_run_at: nextRunAt });
    return existing.id;
  } else {
    return createSchedule({ scenario_id: scenarioId, cron_expr: cronExpr, status, next_run_at: nextRunAt });
  }
}

// Helper: compute next run time from cron expression
// Supports standard 5-field cron: minute hour day month dow
// Uses local time (CST +08:00) for both matching and output
export function computeNextRunFromCron(cronExpr: string | null): string | null {
  if (!cronExpr) return null;

  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length < 5) return null;

  const [minute, hour, day, month, dow] = fields.map(f => f.trim());

  // Use local time to match cron fields and to produce ISO string
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);

  // Try all minutes in the next 2 days (2880 minutes covers any time-of-day in a 24h+ window)
  for (let attempt = 0; attempt < 2880; attempt++) {
    next.setMinutes(next.getMinutes() + 1);

    if (!matchCronField(next.getMinutes(), minute)) continue;
    if (!matchCronField(next.getHours(), hour)) continue;
    if (!matchCronField(next.getDate(), day)) continue;
    if (!matchCronField(next.getMonth() + 1, month)) continue;
    if (!matchCronField(next.getDay(), dow)) continue;

    // Found a match — format as local ISO string (YYYY-MM-DDTHH:mm:ss)
    const pad = (n: number) => String(n).padStart(2, '0');
    const localStr = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}:${pad(next.getSeconds())}`;
    return localStr;
  }

  return null;
}

function matchCronField(value: number, pattern: string): boolean {
  if (pattern === '*') return true;

  // Handle lists (e.g. "1,15,30")
  for (const part of pattern.split(',')) {
    // Handle ranges (e.g. "1-5")
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      if (value >= start && value <= end) return true;
      continue;
    }

    // Handle step (e.g. "*/5")
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      if (value % parseInt(stepMatch[1]) === 0) return true;
      continue;
    }

    // Single value
    if (parseInt(part) === value) return true;
  }

  return false;
}