/**
 * /api/schedule-sets-api — 调度 API 场景集
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findScheduleSetsByUserIdPaginated,
  findScheduleSetById,
  findScheduleSetByScenarioSetId,
  upsertScheduleSet,
  updateScheduleSet,
  deleteScheduleSet,
  computeNextRunFromCron,
} from '../db/schedule-sets-api.js';
import { findSetById } from '../db/scenario-sets.js';
import {
  pauseSchedule,
  resumeSchedule,
  unscheduleCronJob,
  scheduleCronJob,
} from '../scheduler/scheduler.js';

export const scheduleSetApiRoutes = Router();
scheduleSetApiRoutes.use(authMiddleware);

// GET /api/schedule-sets-api
scheduleSetApiRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const result = findScheduleSetsByUserIdPaginated(req.user!.userId, page, pageSize);
  res.json({ code: 200, message: 'ok', data: result });
});

// GET /api/schedule-sets-api/:id
scheduleSetApiRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) {
    res.status(404).json({ code: 404, message: 'Schedule not found' });
    return;
  }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets-api/set/:setId — upsert schedule for a scenario set
scheduleSetApiRoutes.put('/set/:setId', (req: Request, res: Response) => {
  const setId = Number(req.params.setId);
  const set = findSetById(setId);
  if (!set || set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }

  const { cron_expr, status } = req.body as {
    cron_expr?: string;
    status?: 'none' | 'paused' | 'active';
  };

  const newStatus = status || 'none';
  const nextRunAt = newStatus === 'active' && cron_expr
    ? computeNextRunFromCron(cron_expr)
    : null;

  const id = upsertScheduleSet(setId, cron_expr ?? null, newStatus, nextRunAt);

  if (newStatus === 'active' && cron_expr) {
    scheduleCronJob(id, cron_expr, 'api');
  } else {
    unscheduleCronJob(id, 'api');
  }

  const schedule = findScheduleSetById(id);
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets-api/:id/configure
scheduleSetApiRoutes.put('/:id/configure', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) {
    res.status(404).json({ code: 404, message: 'Schedule not found' });
    return;
  }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }

  const { cron_expr, status } = req.body as {
    cron_expr?: string;
    status?: 'none' | 'paused' | 'active';
  };

  const newCron = cron_expr !== undefined ? cron_expr : schedule.cron_expr;
  const newStatus = status !== undefined ? status : schedule.status;
  const nextRunAt = newStatus === 'active' && newCron
    ? computeNextRunFromCron(newCron)
    : null;

  updateScheduleSet(id, {
    cron_expr: newCron ?? null,
    status: newStatus,
    next_run_at: nextRunAt,
  });

  if (newStatus === 'active' && newCron) {
    scheduleCronJob(id, newCron, 'api');
  } else {
    unscheduleCronJob(id, 'api');
  }

  const updated = findScheduleSetById(id);
  res.json({ code: 200, message: 'Updated', data: updated });
});

// POST /api/schedule-sets-api/:id/pause
scheduleSetApiRoutes.post('/:id/pause', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  pauseSchedule(id, 'api');
  res.json({ code: 200, message: 'Paused', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-api/:id/resume
scheduleSetApiRoutes.post('/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  resumeSchedule(id, 'api');
  res.json({ code: 200, message: 'Resumed', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-api/:id/remove
scheduleSetApiRoutes.post('/:id/remove', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  unscheduleCronJob(id, 'api');
  deleteScheduleSet(id);
  res.json({ code: 200, message: 'Removed' });
});
