import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  listPcCases,
  getPcCase,
  createPcCase,
  updatePcCase,
  deletePcCase,
  createPcCaseLog,
  findLogsByPcCaseId,
} from '../db/pc-cases.js';
import { findUserById } from '../db/users.js';
import { executePcCase } from '../engine/pc-executor.js';

export const pcCaseRoutes = Router();
pcCaseRoutes.use(authMiddleware);

// GET /api/pc-cases
pcCaseRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sortField = (req.query.sortField as string) || 'updated_at';
  const sortOrder = (req.query.sortOrder as string) || 'DESC';

  const filters = {
    name: req.query.name as string | undefined,
    status: req.query.status as string | undefined,
    tag: req.query.tag as string | undefined,
  };

  const result = listPcCases(req.user!.userId, page, pageSize, sortField, sortOrder, filters);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/pc-cases
pcCaseRoutes.post('/', (req: Request, res: Response) => {
  const {
    name,
    description,
    tags,
    status,
    steps,
    check_points,
    data_drive,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    preconditions,
  } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const stepsJson = typeof steps === 'string' ? steps : (Array.isArray(steps) ? JSON.stringify(steps) : null);
  const checkPointsJson = typeof check_points === 'string' ? check_points : (Array.isArray(check_points) ? JSON.stringify(check_points) : null);
  const dataDriveJson = typeof data_drive === 'string' ? data_drive : (Array.isArray(data_drive) ? JSON.stringify(data_drive) : null);
  const preconditionsJson = typeof preconditions === 'string' ? preconditions : (Array.isArray(preconditions) ? JSON.stringify(preconditions) : null);

  const id = createPcCase(req.user!.userId, {
    name: name.trim(),
    description,
    tags,
    status,
    steps: stepsJson || undefined,
    check_points: checkPointsJson || undefined,
    data_drive: dataDriveJson || undefined,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    preconditions: preconditionsJson || undefined,
  });
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// Helper: check ownership
function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const pcCase = getPcCase(id);
  if (!pcCase) {
    res.status(404).json({ code: 404, message: 'PC case not found' });
    return null;
  }
  if (pcCase.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return pcCase;
}

// GET /api/pc-cases/:id
pcCaseRoutes.get('/:id', (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;
  res.json({ code: 200, message: 'ok', data: pcCase });
});

// PUT /api/pc-cases/:id
pcCaseRoutes.put('/:id', (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;

  const {
    name,
    description,
    tags,
    status,
    steps,
    check_points,
    data_drive,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    preconditions,
  } = req.body;

  const stepsJson = typeof steps === 'string' ? steps : (Array.isArray(steps) ? JSON.stringify(steps) : undefined);
  const checkPointsJson = typeof check_points === 'string' ? check_points : (Array.isArray(check_points) ? JSON.stringify(check_points) : undefined);
  const dataDriveJson = typeof data_drive === 'string' ? data_drive : (Array.isArray(data_drive) ? JSON.stringify(data_drive) : undefined);
  const preconditionsJson = typeof preconditions === 'string' ? preconditions : (Array.isArray(preconditions) ? JSON.stringify(preconditions) : undefined);

  updatePcCase(pcCase.id, {
    name,
    description,
    tags,
    status,
    steps: stepsJson,
    check_points: checkPointsJson,
    data_drive: dataDriveJson,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    preconditions: preconditionsJson,
  });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/pc-cases/:id
pcCaseRoutes.delete('/:id', (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;
  deletePcCase(pcCase.id);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/pc-cases/:id/execute
pcCaseRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  const result = await executePcCase(pcCase, { executedBy });

  const logId = createPcCaseLog(pcCase.id, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: executedBy,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
  });

  res.json({
    code: 200,
    message: 'ok',
    data: { id: logId, ...result, executed_by: executedBy },
  });
});

// GET /api/pc-cases/:id/logs
pcCaseRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByPcCaseId(pcCase.id, limit);
  res.json({ code: 200, message: 'ok', data: logs });
});