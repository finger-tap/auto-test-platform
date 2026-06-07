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
  createWebCaseExecution,
  finishWebCaseExecution,
  findWebCaseExecutionsByCaseId,
} from '../db/web-cases.js';
import { findUserById } from '../db/users.js';
import { executeWebCase } from '../engine/web-executor.js';
import { relativeReportUrl } from '../engine/report-paths.js';

export const webCaseRoutes = Router();
webCaseRoutes.use(authMiddleware);

// GET /api/web-cases
webCaseRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sortField = (req.query.sortField as string) || 'updated_at';
  const sortOrder = (req.query.sortOrder as string) || 'DESC';
  const filters = {
    name: req.query.name as string | undefined,
    status: req.query.status as string | undefined,
    tag: req.query.tag as string | undefined,
  };

  const result = listWebCases(
    req.user!.userId,
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
    case_content,
    case_content_type,
    driver_path,
    close_browser_after_execution,
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
    case_content: typeof case_content === 'string' ? case_content : null,
    case_content_type: case_content_type === 'yaml' ? 'yaml' : 'text',
    driver_path: typeof driver_path === 'string' && driver_path.trim() ? driver_path.trim() : null,
    close_browser_after_execution: close_browser_after_execution === 1 || close_browser_after_execution === true ? 1 : 0,
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
  const webCase = getWebCase(id);
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
  const webCase = checkOwnership(req, res);
  if (!webCase) return;
  res.json({ code: 200, message: 'ok', data: webCase });
});

// PUT /api/web-cases/:id
webCaseRoutes.put('/:id', (req: Request, res: Response) => {
  const webCase = checkOwnership(req, res);
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
    case_content,
    case_content_type,
    driver_path,
    close_browser_after_execution,
  } = req.body;

  // Serialize JSON fields to strings
  const stepsJson = typeof steps === 'string' ? steps : (Array.isArray(steps) ? JSON.stringify(steps) : undefined);
  const checkPointsJson = typeof check_points === 'string' ? check_points : (Array.isArray(check_points) ? JSON.stringify(check_points) : undefined);
  const dataDriveJson = typeof data_drive === 'string' ? data_drive : (Array.isArray(data_drive) ? JSON.stringify(data_drive) : undefined);
  const preconditionsJson = typeof preconditions === 'string' ? preconditions : (Array.isArray(preconditions) ? JSON.stringify(preconditions) : undefined);

  // driver_path: string (trimmed) = set, null = clear, undefined = leave alone
  const driverPathUpdate =
    typeof driver_path === 'string'
      ? (driver_path.trim() ? driver_path.trim() : null)
      : (driver_path === null ? null : undefined);

  // close_browser_after_execution: true/1 = set 1, false/0 = set 0, undefined = leave alone
  const closeBrowserUpdate =
    close_browser_after_execution === 1 || close_browser_after_execution === true ? 1
    : close_browser_after_execution === 0 || close_browser_after_execution === false ? 0
    : undefined;

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
    case_content: typeof case_content === 'string' ? case_content : (case_content === null ? null : undefined),
    case_content_type: case_content_type === 'yaml' || case_content_type === 'text' ? case_content_type : undefined,
    driver_path: driverPathUpdate,
    close_browser_after_execution: closeBrowserUpdate,
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

  // Phase 2: write a normalized web_case_executions row first so we can
  // store the Midscene report path even on error.
  const startedAt = new Date().toISOString();
  const execId = createWebCaseExecution(webCase.id, req.user!.userId, {
    started_at: startedAt,
    executed_by: executedBy,
  });

  // 2026-06-06: accept an optional `deviceId` to run on a remote agent.
  // null/undefined = local in-process (default). The executor validates
  // ownership + test_type, so this is safe to forward as-is.
  const deviceId = typeof req.body?.deviceId === 'number' ? req.body.deviceId : null;

  const result = await executeWebCase(webCase, {
    executedBy,
    caseId: webCase.id,
    execId,
    userId: req.user!.userId,
    deviceId,
  });

  const finishedAt = new Date().toISOString();
  finishWebCaseExecution(execId, {
    status: result.status,
    finished_at: finishedAt,
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });

  // Backward-compat: also keep web_case_logs writable (UI shows legacy logs)
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
    data: {
      id: logId,
      execution_id: execId,
      report_path: result.report_path || null,
      report_url: result.report_path
        ? relativeReportUrl('web', webCase.id, execId)
        : null,
      executed_by: executedBy,
      ...result,
    },
  });
});

// GET /api/web-cases/:id/executions  (Phase 2 — normalized execution history)
webCaseRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const webCase = checkOwnership(req, res);
  if (!webCase) return;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const items = findWebCaseExecutionsByCaseId(webCase.id, limit);
  res.json({
    code: 200,
    message: 'ok',
    data: items.map((e) => ({
      ...e,
      report_url: e.report_path
        ? relativeReportUrl('web', webCase.id, e.id)
        : null,
    })),
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