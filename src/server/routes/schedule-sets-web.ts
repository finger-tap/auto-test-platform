/**
 * /api/schedule-sets-web — 调度 web 用例集
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
} from '../db/schedule-sets-web.js';
import { findSetById } from '../db/case-sets-web.js';
import {
  pauseSchedule,
  resumeSchedule,
  unscheduleCronJob,
  scheduleCronJob,
} from '../scheduler/scheduler.js';

export const scheduleSetWebRoutes = Router();
scheduleSetWebRoutes.use(authMiddleware);

// GET /api/schedule-sets-web
scheduleSetWebRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const result = findScheduleSetsByUserIdPaginated(req.user!.userId, page, pageSize);
  res.json({ code: 200, message: 'ok', data: result });
});

// GET /api/schedule-sets-web/:id
scheduleSetWebRoutes.get('/:id', (req: Request, res: Response) => {
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

// PUT /api/schedule-sets-web/set/:setId — upsert schedule for a case set
scheduleSetWebRoutes.put('/set/:setId', (req: Request, res: Response) => {
  const setId = Number(req.params.setId);
  const set = findSetById(setId);
  if (!set || set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }

  const { cron_expr, status, device_id } = req.body as {
    cron_expr?: string;
    status?: 'none' | 'paused' | 'active';
    device_id?: number | null;
  };

  const newStatus = status || 'none';
  const nextRunAt = newStatus === 'active' && cron_expr
    ? computeNextRunFromCron(cron_expr)
    : null;

  const id = upsertScheduleSet(setId, cron_expr ?? null, newStatus, nextRunAt, device_id);

  if (newStatus === 'active' && cron_expr) {
    scheduleCronJob(id, cron_expr, 'web');
  } else {
    unscheduleCronJob(id, 'web');
  }

  const schedule = findScheduleSetById(id);
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets-web/:id/configure
scheduleSetWebRoutes.put('/:id/configure', (req: Request, res: Response) => {
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

  const { cron_expr, status, device_id } = req.body as {
    cron_expr?: string;
    status?: 'none' | 'paused' | 'active';
    device_id?: number | null;
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
    device_id: device_id !== undefined ? device_id : schedule.device_id,
  });

  if (newStatus === 'active' && newCron) {
    scheduleCronJob(id, newCron, 'web');
  } else {
    unscheduleCronJob(id, 'web');
  }

  const updated = findScheduleSetById(id);
  res.json({ code: 200, message: 'Updated', data: updated });
});

// POST /api/schedule-sets-web/:id/pause
scheduleSetWebRoutes.post('/:id/pause', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  pauseSchedule(id, 'web');
  res.json({ code: 200, message: 'Paused', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-web/:id/resume
scheduleSetWebRoutes.post('/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  resumeSchedule(id, 'web');
  res.json({ code: 200, message: 'Resumed', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets-web/:id/remove
scheduleSetWebRoutes.post('/:id/remove', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.case_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  unscheduleCronJob(id, 'web');
  deleteScheduleSet(id);
  res.json({ code: 200, message: 'Removed' });
});
