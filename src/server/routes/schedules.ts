import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findSchedulesByUserIdPaginated,
  findSchedulesByUserId,
  findScheduleById,
  findScheduleByScenarioId,
  upsertSchedule,
  updateSchedule,
  deleteSchedule,
  computeNextRunFromCron,
} from '../db/schedules.js';
import { findScenarioById } from '../db/scenarios.js';

export const scheduleRoutes = Router();
scheduleRoutes.use(authMiddleware);

// Helper: check ownership
function checkOwnership(req: Request, res: Response, scheduleId: number) {
  if (!scheduleId) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const schedule = findScheduleById(scheduleId);
  if (!schedule) {
    res.status(404).json({ code: 404, message: 'Schedule not found' });
    return null;
  }
  const scenario = findScenarioById(schedule.scenario_id);
  if (!scenario || scenario.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return { schedule, scenario };
}

// GET /api/schedules
scheduleRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const creator = req.query.creator as string | undefined;
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const { items, total } = findSchedulesByUserIdPaginated(req.user!.userId, page, pageSize, creator, sort, order);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
});

// GET /api/schedules/:id
scheduleRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = checkOwnership(req, res, id);
  if (!result) return;
  res.json({ code: 200, message: 'ok', data: result.schedule });
});

// PUT /api/schedules/:id/configure
// Body: { cron_expr, status }
scheduleRoutes.put('/:id/configure', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = checkOwnership(req, res, id);
  if (!result) return;

  const { cron_expr, status } = req.body as { cron_expr?: string; status?: 'none' | 'paused' | 'active' };

  const newCron = cron_expr !== undefined ? cron_expr : result.schedule.cron_expr;
  const newStatus = status !== undefined ? status : result.schedule.status;
  const nextRunAt = newStatus === 'active' && newCron
    ? computeNextRunFromCron(newCron)
    : null;

  updateSchedule(id, {
    cron_expr: newCron || null,
    status: newStatus,
    next_run_at: nextRunAt,
  });

  const updated = findScheduleById(id);
  res.json({ code: 200, message: 'Updated', data: updated });
});

// POST /api/schedules/:id/pause
scheduleRoutes.post('/:id/pause', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = checkOwnership(req, res, id);
  if (!result) return;

  updateSchedule(id, { status: 'paused', next_run_at: null });
  const updated = findScheduleById(id);
  res.json({ code: 200, message: 'Paused', data: updated });
});

// POST /api/schedules/:id/resume
scheduleRoutes.post('/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = checkOwnership(req, res, id);
  if (!result) return;

  const cronExpr = result.schedule.cron_expr;
  const nextRunAt = cronExpr ? computeNextRunFromCron(cronExpr) : null;
  updateSchedule(id, { status: 'active', next_run_at: nextRunAt });

  const updated = findScheduleById(id);
  res.json({ code: 200, message: 'Resumed', data: updated });
});

// POST /api/schedules/:id/remove — remove the schedule record for a scenario
scheduleRoutes.post('/:id/remove', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = checkOwnership(req, res, id);
  if (!result) return;

  deleteSchedule(id);
  res.json({ code: 200, message: 'Removed' });
});

// PUT /api/schedules/scenario/:scenarioId
// Upsert schedule for a scenario (used when creating schedule from scenario detail)
scheduleRoutes.put('/scenario/:scenarioId', (req: Request, res: Response) => {
  const scenarioId = Number(req.params.scenarioId);
  if (!scenarioId) {
    res.status(400).json({ code: 400, message: 'Invalid scenarioId' });
    return;
  }
  const scenario = findScenarioById(scenarioId);
  if (!scenario || scenario.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return;
  }

  const { cron_expr, status } = req.body as { cron_expr?: string; status?: 'none' | 'paused' | 'active' };
  const newStatus = status || 'none';
  const nextRunAt = newStatus === 'active' && cron_expr
    ? computeNextRunFromCron(cron_expr)
    : null;

  const id = upsertSchedule(scenarioId, cron_expr || null, newStatus, nextRunAt);
  const schedule = findScheduleById(id);
  res.json({ code: 200, message: 'ok', data: schedule });
});