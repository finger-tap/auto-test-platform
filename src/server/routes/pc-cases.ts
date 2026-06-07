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
  createPcCaseExecution,
  finishPcCaseExecution,
  findPcCaseExecutionsByCaseId,
} from '../db/pc-cases.js';
import { findUserById } from '../db/users.js';
import { executePcCase } from '../engine/pc-executor.js';
import { relativeReportUrl } from '../engine/report-paths.js';

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
    window_size,
    timeout,
    preconditions,
    case_content,
    case_content_type,
    driver_path,
    close_browser_after_execution,
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
    window_size,
    timeout,
    preconditions: preconditionsJson || undefined,
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
    window_size,
    timeout,
    preconditions,
    case_content,
    case_content_type,
    driver_path,
    close_browser_after_execution,
  } = req.body;

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

  updatePcCase(pcCase.id, {
    name,
    description,
    tags,
    status,
    steps: stepsJson,
    check_points: checkPointsJson,
    data_drive: dataDriveJson,
    window_size,
    timeout,
    preconditions: preconditionsJson,
    case_content: typeof case_content === 'string' ? case_content : (case_content === null ? null : undefined),
    case_content_type: case_content_type === 'yaml' || case_content_type === 'text' ? case_content_type : undefined,
    driver_path: driverPathUpdate,
    close_browser_after_execution: closeBrowserUpdate,
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
  const deviceId = Number(req.query.deviceId) || undefined;

  // Phase 3: write a normalized pc_case_executions row first.
  const startedAt = new Date().toISOString();
  const execId = createPcCaseExecution(pcCase.id, req.user!.userId, {
    started_at: startedAt,
    executed_by: executedBy,
  });

  const result = await executePcCase(pcCase, {
    executedBy,
    caseId: pcCase.id,
    execId,
    deviceId,
    userId: req.user!.userId,
  });

  const finishedAt = new Date().toISOString();
  finishPcCaseExecution(execId, {
    status: result.status,
    finished_at: finishedAt,
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });

  // Backward-compat: also keep pc_case_logs writable (UI shows legacy logs).
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
    data: {
      id: logId,
      execution_id: execId,
      report_path: result.report_path || null,
      report_url: result.report_path
        ? relativeReportUrl('computer', pcCase.id, execId)
        : null,
      device: result.device || null,
      executed_by: executedBy,
      ...result,
    },
  });
});

// GET /api/pc-cases/:id/executions  (Phase 3 — normalized execution history)
pcCaseRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const pcCase = checkOwnership(req, res);
  if (!pcCase) return;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const items = findPcCaseExecutionsByCaseId(pcCase.id, limit);
  res.json({
    code: 200,
    message: 'ok',
    data: items.map((e) => ({
      ...e,
      report_url: e.report_path
        ? relativeReportUrl('computer', pcCase.id, e.id)
        : null,
    })),
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