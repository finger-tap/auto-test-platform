import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findMobileTestsByUserIdPaginated,
  findMobileTestById,
  createMobileTest,
  updateMobileTest,
  deleteMobileTest,
  createMobileTestLog,
  findLogsByMobileTestCaseId,
} from '../db/mobile-tests.js';
import { findUserById } from '../db/users.js';
import { executeMobileTest } from '../engine/mobile-executor.js';

export const mobileTestRoutes = Router();
mobileTestRoutes.use(authMiddleware);

// GET /api/mobile-tests
mobileTestRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const { items, total } = findMobileTestsByUserIdPaginated(req.user!.userId, page, pageSize, sort, order);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
});

// POST /api/mobile-tests
mobileTestRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, platform, device_name, platform_version, app_package, app_activity, bundle_id, appium_url, capabilities, test_script, assertions, tags, status } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const id = createMobileTest(req.user!.userId, {
    name: name.trim(), description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, tags, status,
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
  const testCase = findMobileTestById(id);
  if (!testCase) {
    res.status(404).json({ code: 404, message: 'Test case not found' });
    return null;
  }
  if (testCase.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return testCase;
}

// GET /api/mobile-tests/:id
mobileTestRoutes.get('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  res.json({ code: 200, message: 'ok', data: testCase });
});

// PUT /api/mobile-tests/:id
mobileTestRoutes.put('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;

  const { name, description, platform, device_name, platform_version, app_package, app_activity, bundle_id, appium_url, capabilities, test_script, assertions, tags, status } = req.body;
  updateMobileTest(testCase.id, {
    name, description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, tags, status,
  });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/mobile-tests/:id
mobileTestRoutes.delete('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  deleteMobileTest(testCase.id);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/mobile-tests/:id/execute
mobileTestRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  const result = await executeMobileTest(testCase, { executedBy });

  const logId = createMobileTestLog(testCase.id, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: executedBy,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
    screenshots: JSON.stringify(result.screenshots),
  });

  res.json({
    code: 200, message: 'ok',
    data: { id: logId, ...result, executed_by: executedBy },
  });
});

// GET /api/mobile-tests/:id/logs
mobileTestRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByMobileTestCaseId(testCase.id, limit);
  res.json({ code: 200, message: 'ok', data: logs });
});
