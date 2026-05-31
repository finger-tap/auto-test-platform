import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  listWebCases,
  getWebCase,
  createWebCase,
  updateWebCase,
  deleteWebCase,
  createWebCaseLog,
  findLogsByWebCaseId,
} from '../db/web-cases.js';
import { findUserById } from '../db/users.js';
import { executeWebCase } from '../engine/web-executor.js';

export const webCaseRoutes = Router();
webCaseRoutes.use(authMiddleware);

// GET /api/web-cases
webCaseRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sortField = (req.query.sortField as string) || 'updated_at';
  const sortOrder = (req.query.sortOrder as string) || 'DESC';
  const testType = (req.query.test_type as string) || 'web';

  const filters = {
    name: req.query.name as string | undefined,
    status: req.query.status as string | undefined,
    tag: req.query.tag as string | undefined,
  };

  const result = listWebCases(
    req.user!.userId,
    testType,
    page,
    pageSize,
    sortField,
    sortOrder,
    filters
  );
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/web-cases
webCaseRoutes.post('/', (req: Request, res: Response) => {
  const {
    name,
    description,
    tags,
    status,
    steps,
    check_points,
    data_drive,
    preconditions,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    test_type,
  } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  // Serialize JSON fields to strings
  const stepsJson = typeof steps === 'string' ? steps : (Array.isArray(steps) ? JSON.stringify(steps) : null);
  const checkPointsJson = typeof check_points === 'string' ? check_points : (Array.isArray(check_points) ? JSON.stringify(check_points) : null);
  const dataDriveJson = typeof data_drive === 'string' ? data_drive : (Array.isArray(data_drive) ? JSON.stringify(data_drive) : null);
  const preconditionsJson = typeof preconditions === 'string' ? preconditions : (Array.isArray(preconditions) ? JSON.stringify(preconditions) : null);

  const id = createWebCase(req.user!.userId, {
    name: name.trim(),
    description,
    tags,
    status,
    steps: stepsJson || undefined,
    check_points: checkPointsJson || undefined,
    data_drive: dataDriveJson || undefined,
    preconditions: preconditionsJson || undefined,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    test_type: test_type || 'web',
  });
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// Helper: check ownership
function checkOwnership(req: Request, res: Response, testType?: string) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const webCase = getWebCase(id, testType);
  if (!webCase) {
    res.status(404).json({ code: 404, message: 'Web case not found' });
    return null;
  }
  if (webCase.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return webCase;
}

// GET /api/web-cases/:id
webCaseRoutes.get('/:id', (req: Request, res: Response) => {
  const testType = (req.query.test_type as string) || 'web';
  const webCase = checkOwnership(req, res, testType);
  if (!webCase) return;
  res.json({ code: 200, message: 'ok', data: webCase });
});

// PUT /api/web-cases/:id
webCaseRoutes.put('/:id', (req: Request, res: Response) => {
  const testType = (req.body.test_type as string) || 'web';
  const webCase = checkOwnership(req, res, testType);
  if (!webCase) return;

  const {
    name,
    description,
    tags,
    status,
    steps,
    check_points,
    data_drive,
    preconditions,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    test_type,
  } = req.body;

  // Serialize JSON fields to strings
  const stepsJson = typeof steps === 'string' ? steps : (Array.isArray(steps) ? JSON.stringify(steps) : undefined);
  const checkPointsJson = typeof check_points === 'string' ? check_points : (Array.isArray(check_points) ? JSON.stringify(check_points) : undefined);
  const dataDriveJson = typeof data_drive === 'string' ? data_drive : (Array.isArray(data_drive) ? JSON.stringify(data_drive) : undefined);
  const preconditionsJson = typeof preconditions === 'string' ? preconditions : (Array.isArray(preconditions) ? JSON.stringify(preconditions) : undefined);

  updateWebCase(webCase.id, {
    name,
    description,
    tags,
    status,
    steps: stepsJson,
    check_points: checkPointsJson,
    data_drive: dataDriveJson,
    preconditions: preconditionsJson,
    browser,
    window_size,
    timeout,
    headless_mode,
    base_url,
    test_type,
  });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/web-cases/:id
webCaseRoutes.delete('/:id', (req: Request, res: Response) => {
  const webCase = checkOwnership(req, res);
  if (!webCase) return;
  deleteWebCase(webCase.id);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/web-cases/:id/execute
webCaseRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const webCase = checkOwnership(req, res);
  if (!webCase) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  const result = await executeWebCase(webCase, { executedBy });

  const logId = createWebCaseLog(webCase.id, {
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

// GET /api/web-cases/:id/logs
webCaseRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const webCase = checkOwnership(req, res);
  if (!webCase) return;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByWebCaseId(webCase.id, limit);
  res.json({ code: 200, message: 'ok', data: logs });
});