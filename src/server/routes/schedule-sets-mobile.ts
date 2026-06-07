/**
 * /api/schedule-sets-mobile — 调度 移动端 用例集
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findScheduleSetsByUserIdPaginated,
  findScheduleSetById,
  findScheduleSetByCaseSetId,
  upsertScheduleSet,
  updateScheduleSet,
  deleteScheduleSet,
  computeNextRunFromCron,
} from '../db/schedule-sets-mobile.js';
import { findSetById } from '../db/case-sets-mobile.js';
import {
  pauseSchedule,
  resumeSchedule,
  unscheduleCronJob,
  scheduleCronJob,
} from '../scheduler/scheduler.js';

export const scheduleSetMobileRoutes = Router();
scheduleSetMobileRoutes.use(authMiddleware);

// GET /api/schedule-sets-mobile
scheduleSetMobileRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const result = findScheduleSetsByUserIdPaginated(req.user!.userId, page, pageSize);
  res.json({ code: 200, message: 'ok', data: result });
});

// GET /api/schedule-sets-mobile/:id
scheduleSetMobileRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) {
    res.status(404).json({ code: 404, message: 'Schedule not found' });
    return;
  }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets-mobile/set/:setId — upsert schedule for a case set
scheduleSetMobileRoutes.put('/set/:setId', (req: Request, res: Response) => {
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
    scheduleCronJob(id, cron_expr, 'mobile');
  } else {
    unscheduleCronJob(id, 'mobile');
  }

  const schedule = findScheduleSetById(id);
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets-mobile/:id/configure
scheduleSetMobileRoutes.put('/:id/configure', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) {
    res.status(404).json({ code: 404, message: 'Schedule not found' });
    return;
  }
  const set = findSetById(schedule.case_set_id);
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
    scheduleCronJob(id, newCron, 'mobile');
  } else {
    unscheduleCronJob(id, 'mobile');
  }

  const updated = findScheduleSetById(id);
  res.json({ code: 200, message: 'Updated', data: updated });
});

// POST /api/schedule-sets-mobile/:id/pause
scheduleSetMobileRoutes.post('/:id/pause', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  pauseSchedule(id, 'mobile');
  res.json({ code: 200, message: 'Paused', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-mobile/:id/resume
scheduleSetMobileRoutes.post('/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  resumeSchedule(id, 'mobile');
  res.json({ code: 200, message: 'Resumed', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-mobile/:id/remove
scheduleSetMobileRoutes.post('/:id/remove', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  unscheduleCronJob(id, 'mobile');
  deleteScheduleSet(id);
  res.json({ code: 200, message: 'Removed' });
});
