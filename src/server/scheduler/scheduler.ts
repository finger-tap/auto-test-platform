/**
 * Scheduler — polls for due schedules and triggers scenario execution.
 * Runs as a background loop inside the Express server process.
 */

import { upsertScheduleSet, updateScheduleSet, findActiveScheduleSets, computeNextRunFromCron } from '../db/schedule-sets.js';
import { findSetById } from '../db/scenario-sets.js';
import { findUserById } from '../db/users.js';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 30_000;

export function startScheduler(): void {
  if (schedulerTimer) return;
  console.log('[Scheduler] Started');
  isRunning = true;
  runSchedulerCycle().catch(console.error);
  schedulerTimer = setInterval(() => { runSchedulerCycle().catch(console.error); }, POLL_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; isRunning = false; console.log('[Scheduler] Stopped'); }
}

export function schedulerStatus(): { running: boolean } { return { running: isRunning }; }

async function runSchedulerCycle(): Promise<void> {
  if (!isRunning) return;

  try {
    const activeSchedules = findActiveScheduleSets();
    const now = new Date();

    for (const schedule of activeSchedules) {
      if (!isDue(schedule, now)) continue;

      const set = findSetById(schedule.scenario_set_id);
      if (!set) continue;

      console.log(`[Scheduler] Triggering schedule_sets ${schedule.id} (set ${schedule.scenario_set_id}: ${set.name})`);

      try {
        const { runBatch } = await import('../engine/batch-executor.js');
        const { saveBatchReport } = await import('../db/batch-reports.js');
        const executedBy = findUserById(set.user_id)?.nickname || findUserById(set.user_id)?.account || 'scheduler';

        const report = await runBatch(schedule.scenario_set_id, executedBy);
        saveBatchReport(report);

        if (schedule.status === 'active' && schedule.cron_expr) {
          const nextRunAt = computeNextRunFromCron(schedule.cron_expr);
          upsertScheduleSet(schedule.id, schedule.cron_expr, 'active', nextRunAt);
          updateScheduleSetLastRun(schedule.id, now.toISOString(), 'completed');
        } else {
          upsertScheduleSet(schedule.id, schedule.cron_expr, 'none', null);
          updateScheduleSetLastRun(schedule.id, now.toISOString(), 'completed');
        }
        console.log(`[Scheduler] Set ${schedule.scenario_set_id} batch done, next run: ${schedule.cron_expr ? computeNextRunFromCron(schedule.cron_expr) : 'none'}`);
      } catch (err) {
        console.error(`[Scheduler] Failed for schedule_sets ${schedule.id}:`, err);
        upsertScheduleSet(schedule.id, schedule.cron_expr, 'paused', null);
        updateScheduleSetLastRun(schedule.id, now.toISOString(), 'failed');
      }
    }
  } catch (err) {
    console.error('[Scheduler] Cycle error:', err);
  }
}

function isDue(schedule: { status: string; next_run_at: string | null }, now: Date): boolean {
  if (schedule.status !== 'active') return false;
  if (!schedule.next_run_at) return false;
  return new Date(schedule.next_run_at).getTime() <= now.getTime() + 5000;
}

import db from '../db/index.js';

function updateScheduleSetLastRun(id: number, lastRunAt: string, lastRunStatus: string): void {
  db.prepare("UPDATE schedule_sets SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?").run(lastRunAt, lastRunStatus, id);
}