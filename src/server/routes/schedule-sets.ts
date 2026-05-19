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
} from '../db/schedule-sets.js';
import { findSetById } from '../db/scenario-sets.js';

export const scheduleSetRoutes = Router();
scheduleSetRoutes.use(authMiddleware);

// GET /api/schedule-sets — list with scenario_set info
scheduleSetRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const result = findScheduleSetsByUserIdPaginated(req.user!.userId, page, pageSize);
  res.json({ code: 200, message: 'ok', data: result });
});

// GET /api/schedule-sets/:id
scheduleSetRoutes.get('/:id', (req: Request, res: Response) => {
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

// PUT /api/schedule-sets/set/:setId — upsert schedule for a scenario set
scheduleSetRoutes.put('/set/:setId', (req: Request, res: Response) => {
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
  const schedule = findScheduleSetById(id);
  res.json({ code: 200, message: 'ok', data: schedule });
});

// PUT /api/schedule-sets/:id/configure
scheduleSetRoutes.put('/:id/configure', (req: Request, res: Response) => {
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

  const updated = findScheduleSetById(id);
  res.json({ code: 200, message: 'Updated', data: updated });
});

// POST /api/schedule-sets/:id/pause
scheduleSetRoutes.post('/:id/pause', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  updateScheduleSet(id, { status: 'paused', next_run_at: null });
  res.json({ code: 200, message: 'Paused', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets/:id/resume
scheduleSetRoutes.post('/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  const nextRunAt = schedule.cron_expr ? computeNextRunFromCron(schedule.cron_expr) : null;
  updateScheduleSet(id, { status: 'active', next_run_at: nextRunAt });
  res.json({ code: 200, message: 'Resumed', data: findScheduleSetById(id) });
});

// POST /api/schedule-sets/:id/remove
scheduleSetRoutes.post('/:id/remove', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schedule = findScheduleSetById(id);
  if (!schedule) { res.status(404).json({ code: 404, message: 'Schedule not found' }); return; }
  const set = findSetById(schedule.scenario_set_id);
  if (!set || set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return; }

  deleteScheduleSet(id);
  res.json({ code: 200, message: 'Removed' });
});