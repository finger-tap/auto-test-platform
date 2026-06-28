/**
 * Scheduler — uses node-cron for precise scheduling.
 * Loads all active schedule_sets_* tasks at startup and manages cron jobs.
 *
 * 2026-06-05: schedule_sets 拆 4 张(api/web/pc/mobile)。每张表的 cron job
 * key 形如 `${testType}-${id}`,避免 id 冲突。runSchedule(scheduleId,
 * testType) 接受 testType 参数,根据类型路由到 runBatch(api) 或
 * runCaseSet(web/pc/mobile)。
 *
 * 2026-06-07: scanDeviceVersions() runs once at startup to mark any web
 * device whose last seen agent_version doesn't match the server's
 * required version as `needs_upgrade=1`. The UI's "重连/升级" button
 * is gated on this flag.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { findActiveScheduleSets as findActiveApi } from '../db/schedule-sets-api.js';
import { findActiveScheduleSets as findActiveWeb } from '../db/schedule-sets-web.js';
import { findActiveScheduleSets as findActivePc } from '../db/schedule-sets-pc.js';
import { findActiveScheduleSets as findActiveMobile } from '../db/schedule-sets-mobile.js';
import { updateScheduleSet as updateApi, findScheduleSetById as findApiById, computeNextRunFromCron as computeApi } from '../db/schedule-sets-api.js';
import { updateScheduleSet as updateWeb, findScheduleSetById as findWebById, computeNextRunFromCron as computeWeb } from '../db/schedule-sets-web.js';
import { updateScheduleSet as updatePc, findScheduleSetById as findPcById, computeNextRunFromCron as computePc } from '../db/schedule-sets-pc.js';
import { updateScheduleSet as updateMobile, findScheduleSetById as findMobileById, computeNextRunFromCron as computeMobile } from '../db/schedule-sets-mobile.js';
import { findSetById as findApiSet } from '../db/scenario-sets.js';
import { findSetById as findWebCaseSet } from '../db/case-sets-web.js';
import { findSetById as findPcCaseSet } from '../db/case-sets-pc.js';
import { findSetById as findMobileCaseSet } from '../db/case-sets-mobile.js';
import { findUserById } from '../db/users.js';
import { listWebDevicesWithAgent, listMobileDevicesWithAgent, getRequiredAgentVersion, setNeedsUpgrade } from '../db/devices.js';
import db from '../db/index.js';

export type SchedulerTestType = 'api' | 'web' | 'pc' | 'mobile';

interface ScheduleSetLike {
  id: number;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  // API 端的 schedule_sets_api 列名是 scenario_set_id(指向 scenario_sets),
  // web/pc/mobile 端的 schedule_sets_* 列名是 case_set_id(指向各自 case_sets_*)。
  // 两个字段都可能是 undefined,运行时按 testType 选一个用。
  scenario_set_id?: number;
  case_set_id?: number;
  device_id?: number | null;
  [k: string]: unknown;
}

function jobKey(testType: SchedulerTestType, scheduleId: number): string {
  return `${testType}-${scheduleId}`;
}

function updateLastRun(testType: SchedulerTestType, id: number, lastRunAt: string, lastRunStatus: string): void {
  const table = `schedule_sets_${testType}`;
  db.prepare(
    `UPDATE ${table} SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?`
  ).run(lastRunAt, lastRunStatus, id);
}

// scheduleJobKey (e.g. "api-3") -> cron task
const cronJobs = new Map<string, ScheduledTask>();

export function startScheduler(): void {
  console.log('[Scheduler] Starting...');

  // 2026-06-07: one-shot version scan. Marks every web device whose
  // agent_version differs from the server's required version as
  // needs_upgrade=1. The scan is read-only: it doesn't SSH, doesn't
  // restart agents. The user must click "重连/升级" in the UI to act.
  scanDeviceVersions();

  let totalLoaded = 0;
  for (const t of ['api', 'web', 'pc', 'mobile'] as const) {
    const list = t === 'api' ? findActiveApi()
              : t === 'web' ? findActiveWeb()
              : t === 'pc' ? findActivePc()
              : findActiveMobile();
    for (const s of list) {
      if (s.cron_expr) {
        scheduleCronJob(s.id, s.cron_expr, t);
        totalLoaded++;
      }
    }
    console.log(`[Scheduler] Loaded ${list.length} active schedule(s) for type=${t}`);
  }
  console.log(`[Scheduler] Found ${totalLoaded} active cron job(s) total`);

  // Phase 5.6: daily cleanup of Midscene reports > 30 days old. 3:17am
  // (off-the-hour to avoid fleet-wide API contention).
  const reportCleanupJob = cron.schedule('17 3 * * *', async () => {
    const { cleanupOldReports } = await import('./report-cleanup.js');
    const stats = await cleanupOldReports();
    console.log(`[Scheduler] Report cleanup: scanned=${stats.scanned} removed=${stats.removed} errors=${stats.errors} took=${stats.duration_ms}ms`);
  });
  cronJobs.set('__report-cleanup__', reportCleanupJob);

  // 2026-06-06: agent offline detection. The agent sends a heartbeat every
  // 30s; if the last_seen_at is older than 90s the agent is presumed dead
  // (network blip, crash, machine off) and we flip its status to offline
  // so the UI doesn't keep trying to dispatch cases to a ghost agent.
  // Run every minute. 1:13am-ish (off-the-hour, random pick) — we don't
  // care about exact minute, just that it's not on a fleet-wide boundary.
  const agentHeartbeatJob = cron.schedule('13 * * * *', async () => {
    try {
      const { markStaleAgentsOffline } = await import('../db/devices.js');
      const stats = markStaleAgentsOffline(90);
      if (stats.flipped > 0) {
        console.log(`[Scheduler] Agent offline detection: scanned=${stats.scanned} flipped=${stats.flipped}`);
      }
    } catch (e) {
      console.log(`[Scheduler] Agent offline detection error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  cronJobs.set('__agent-heartbeat__', agentHeartbeatJob);

  console.log('[Scheduler] Started');
}

export function stopScheduler(): void {
  for (const [key, task] of cronJobs) {
    task.stop();
    console.log(`[Scheduler] Stopped job ${key}`);
  }
  cronJobs.clear();
  console.log('[Scheduler] Stopped');
}

export function schedulerStatus(): { running: boolean; activeJobs: number } {
  return { running: cronJobs.size > 0, activeJobs: cronJobs.size };
}

/**
 * Schedule a cron job for a given schedule_set record (per testType).
 * Stops existing job if already running.
 */
export function scheduleCronJob(scheduleId: number, cronExpr: string, testType: SchedulerTestType): void {
  const key = jobKey(testType, scheduleId);
  const existing = cronJobs.get(key);
  if (existing) {
    existing.stop();
    cronJobs.delete(key);
  }

  if (!cronExpr) return;

  if (!cron.validate(cronExpr)) {
    console.warn(`[Scheduler] Invalid cron expression "${cronExpr}" for ${testType} schedule ${scheduleId}; skipping.`);
    return;
  }

  const task = cron.schedule(cronExpr, async () => {
    await runSchedule(scheduleId, testType);
  }, {
    timezone: 'Asia/Shanghai',
  });

  cronJobs.set(key, task);
  console.log(`[Scheduler] Scheduled job ${key} with cron "${cronExpr}"`);
}

/**
 * Stop and remove a cron job for a schedule.
 */
export function unscheduleCronJob(scheduleId: number, testType: SchedulerTestType): void {
  const key = jobKey(testType, scheduleId);
  const existing = cronJobs.get(key);
  if (existing) {
    existing.stop();
    cronJobs.delete(key);
    console.log(`[Scheduler] Unscheduled job ${key}`);
  }
}

/**
 * Pause: stop cron job, update DB status to paused.
 */
export function pauseSchedule(scheduleId: number, testType: SchedulerTestType): void {
  unscheduleCronJob(scheduleId, testType);
  const updater = pickUpdater(testType);
  updater(scheduleId, { status: 'paused', next_run_at: null });
}

/**
 * Resume: restart cron job with existing cron_expr, update DB.
 */
export function resumeSchedule(scheduleId: number, testType: SchedulerTestType): void {
  const row = pickFinder(testType)(scheduleId);
  if (!row || !row.cron_expr) return;
  const nextRunAt = pickCompute(testType)(row.cron_expr);
  pickUpdater(testType)(scheduleId, { status: 'active', next_run_at: nextRunAt });
  scheduleCronJob(scheduleId, row.cron_expr, testType);
}

function pickUpdater(testType: SchedulerTestType) {
  if (testType === 'api') return updateApi;
  if (testType === 'web') return updateWeb;
  if (testType === 'pc') return updatePc;
  return updateMobile;
}
function pickFinder(testType: SchedulerTestType) {
  if (testType === 'api') return findApiById;
  if (testType === 'web') return findWebById;
  if (testType === 'pc') return findPcById;
  return findMobileById;
}
function pickCompute(testType: SchedulerTestType) {
  if (testType === 'api') return computeApi;
  if (testType === 'web') return computeWeb;
  if (testType === 'pc') return computePc;
  return computeMobile;
}
function pickSetFinder(testType: SchedulerTestType) {
  if (testType === 'api') return findApiSet;
  if (testType === 'web') return findWebCaseSet;
  if (testType === 'pc') return findPcCaseSet;
  return findMobileCaseSet;
}

export async function runSchedule(scheduleId: number, testType: SchedulerTestType): Promise<void> {
  // Cast through unknown: per-type ScheduleSetRow has a defined shape, but
  // runSchedule only needs a few common fields.
  const schedule = pickFinder(testType)(scheduleId) as unknown as ScheduleSetLike | undefined;
  if (!schedule || schedule.status !== 'active') {
    unscheduleCronJob(scheduleId, testType);
    return;
  }

  // Set id:API 端列名 scenario_set_id(指向 scenario_sets.id),
  // web/pc/mobile 端列名 case_set_id(指向各自 case_sets_*.id)。两种类型都按 testType 路由解析。
  const setId = (testType === 'api'
    ? schedule.scenario_set_id
    : schedule.case_set_id) as number | undefined;
  if (!setId) {
    console.error(`[Scheduler] ${testType} schedule ${scheduleId} has no set id`);
    unscheduleCronJob(scheduleId, testType);
    return;
  }
  const set = pickSetFinder(testType)(setId);
  if (!set) {
    console.error(`[Scheduler] ${testType} set ${setId} not found for schedule ${scheduleId}`);
    unscheduleCronJob(scheduleId, testType);
    return;
  }

  const now = new Date().toISOString();
  const setName = (set as { name: string }).name;
  console.log(`[Scheduler] Triggering ${testType} schedule_sets ${scheduleId} (set ${setId}: ${setName})`);

  try {
    const executor = findUserById((set as { user_id: number }).user_id);
    const executedBy = executor?.nickname || executor?.account || 'scheduler';

    if (testType === 'api') {
      const { runBatch } = await import('../engine/batch-executor.js');
      await runBatch(setId, executedBy);
    } else {
      const { runCaseSet } = await import('../engine/case-set-executor.js');
      const deviceId = schedule.device_id ?? undefined;
      await runCaseSet(setId, testType, executedBy, undefined, undefined, deviceId);
    }

    const nextRunAt = schedule.cron_expr ? pickCompute(testType)(schedule.cron_expr) : null;
    pickUpdater(testType)(scheduleId, {
      status: 'active',
      next_run_at: nextRunAt,
    });
    updateLastRun(testType, scheduleId, now, 'completed');

    console.log(`[Scheduler] ${testType} set ${setId} done, next run: ${nextRunAt ?? 'none'}`);
  } catch (err) {
    console.error(`[Scheduler] Failed for ${testType} schedule_sets ${scheduleId}:`, err);
    updateLastRun(testType, scheduleId, now, 'failed');
    // Keep the cron job running; it will fire again at the next scheduled time
  }
}

/**
 * 2026-06-07: one-shot startup version scan. For each web device with
 * an agent_token, compare the last seen agent_version against the
 * server's required version. If they differ, mark needs_upgrade=1.
 *
 * The flag is read by the UI to show the "重连/升级" button. The server
 * does NOT auto-push — push is always an explicit user action.
 *
 * Devices that have never reported a version (agent_version is null)
 * are left alone — they're not yet online, so there's nothing to
 * upgrade yet. The flag will get set by the next 401 response.
 *
 * 2026-06-08: mobile-agent 共用同一份 agent_token / agent_version 协议,
 * 所以这里也扫 mobile 设备。逻辑合并到 scanKind('web' | 'mobile') helper。
 */
export function scanDeviceVersions(): void {
  const required = getRequiredAgentVersion();
  if (required === 'unknown') {
    console.warn('[Scheduler] scanDeviceVersions: required version is unknown (package.json read failed); skipping');
    return;
  }
  const webMarked = scanKind('web', listWebDevicesWithAgent(), required);
  const mobileMarked = scanKind('mobile', listMobileDevicesWithAgent(), required);
  const totalMarked = webMarked + mobileMarked;
  if (totalMarked > 0) {
    console.log(`[Scheduler] scanDeviceVersions: marked ${totalMarked} device(s) as needs_upgrade (web=${webMarked}, mobile=${mobileMarked}, required=${required})`);
  }
}

function scanKind(kind: 'web' | 'mobile', devices: ReturnType<typeof listWebDevicesWithAgent>, required: string): number {
  if (devices.length === 0) {
    console.log(`[Scheduler] scanDeviceVersions: 0 ${kind} devices with agents, required=${required}`);
    return 0;
  }
  let marked = 0;
  for (const d of devices) {
    if (!d.agent_version) continue;
    const mismatch = d.agent_version !== required;
    const shouldFlag = mismatch ? 1 : 0;
    if (d.needs_upgrade !== shouldFlag) {
      setNeedsUpgrade(d.id, mismatch);
      marked++;
    }
  }
  if (marked === 0) {
    console.log(`[Scheduler] scanDeviceVersions: all ${devices.length} ${kind} device(s) match required=${required}`);
  }
  return marked;
}
