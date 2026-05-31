/**
 * Scheduler — uses node-cron for precise scheduling.
 * Loads all active schedule_sets tasks at startup and manages cron jobs.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { upsertScheduleSet, updateScheduleSet, findActiveScheduleSets, findScheduleSetById, computeNextRunFromCron } from '../db/schedule-sets.js';
import { findSetById } from '../db/scenario-sets.js';
import { findUserById } from '../db/users.js';
import db from '../db/index.js';

function updateLastRun(id: number, lastRunAt: string, lastRunStatus: string): void {
  db.prepare(
    "UPDATE schedule_sets SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?"
  ).run(lastRunAt, lastRunStatus, id);
}

// scheduleId -> cron task
const cronJobs = new Map<number, ScheduledTask>();

export function startScheduler(): void {
  console.log('[Scheduler] Starting...');

  // Load all active schedules and create cron jobs
  const activeSchedules = findActiveScheduleSets();
  console.log(`[Scheduler] Found ${activeSchedules.length} active schedule(s)`);

  for (const schedule of activeSchedules) {
    scheduleCronJob(schedule.id, schedule.cron_expr!);
  }

  console.log('[Scheduler] Started');
}

export function stopScheduler(): void {
  for (const [id, task] of cronJobs) {
    task.stop();
    console.log(`[Scheduler] Stopped job ${id}`);
  }
  cronJobs.clear();
  console.log('[Scheduler] Stopped');
}

export function schedulerStatus(): { running: boolean; activeJobs: number } {
  return { running: cronJobs.size > 0, activeJobs: cronJobs.size };
}

/**
 * Schedule a cron job for a given schedule_set record.
 * Stops existing job if already running.
 */
export function scheduleCronJob(scheduleId: number, cronExpr: string): void {
  // Stop existing job if any
  const existing = cronJobs.get(scheduleId);
  if (existing) {
    existing.stop();
    cronJobs.delete(scheduleId);
  }

  if (!cronExpr) return;

  const task = cron.schedule(cronExpr, async () => {
    await runSchedule(scheduleId);
  }, {
    timezone: 'Asia/Shanghai',
  });

  cronJobs.set(scheduleId, task);
  console.log(`[Scheduler] Scheduled job ${scheduleId} with cron "${cronExpr}"`);
}

/**
 * Stop and remove a cron job for a schedule.
 */
export function unscheduleCronJob(scheduleId: number): void {
  const existing = cronJobs.get(scheduleId);
  if (existing) {
    existing.stop();
    cronJobs.delete(scheduleId);
    console.log(`[Scheduler] Unscheduled job ${scheduleId}`);
  }
}

/**
 * Pause: stop cron job, update DB status to paused.
 */
export function pauseSchedule(scheduleId: number): void {
  unscheduleCronJob(scheduleId);
  updateScheduleSet(scheduleId, { status: 'paused', next_run_at: null });
}

/**
 * Resume: restart cron job with existing cron_expr, update DB.
 */
export function resumeSchedule(scheduleId: number): void {
  const schedule = findScheduleSetById(scheduleId);
  if (!schedule || !schedule.cron_expr) return;
  const nextRunAt = computeNextRunFromCron(schedule.cron_expr);
  updateScheduleSet(scheduleId, { status: 'active', next_run_at: nextRunAt });
  scheduleCronJob(scheduleId, schedule.cron_expr);
}

async function runSchedule(scheduleId: number): Promise<void> {
  const schedule = findScheduleSetById(scheduleId);
  if (!schedule || schedule.status !== 'active') {
    unscheduleCronJob(scheduleId);
    return;
  }

  const set = findSetById(schedule.scenario_set_id);
  if (!set) {
    console.error(`[Scheduler] Scenario set ${schedule.scenario_set_id} not found for schedule ${scheduleId}`);
    unscheduleCronJob(scheduleId);
    return;
  }

  const now = new Date().toISOString();
  console.log(`[Scheduler] Triggering schedule_sets ${scheduleId} (set ${schedule.scenario_set_id}: ${set.name})`);

  try {
    const { runBatch } = await import('../engine/batch-executor.js');
    const executedBy = findUserById(set.user_id)?.nickname
      || findUserById(set.user_id)?.account
      || 'scheduler';

    await runBatch(schedule.scenario_set_id, executedBy);

    // Completed: update last run, compute next run
    const nextRunAt = schedule.cron_expr ? computeNextRunFromCron(schedule.cron_expr) : null;
    upsertScheduleSet(scheduleId, schedule.cron_expr, 'active', nextRunAt);
    updateLastRun(scheduleId, now, 'completed');

    console.log(`[Scheduler] Set ${schedule.scenario_set_id} done, next run: ${nextRunAt ?? 'none'}`);
  } catch (err) {
    console.error(`[Scheduler] Failed for schedule_sets ${scheduleId}:`, err);
    updateLastRun(scheduleId, now, 'failed');
    // Keep the cron job running; it will fire again at the next scheduled time
  }
}
