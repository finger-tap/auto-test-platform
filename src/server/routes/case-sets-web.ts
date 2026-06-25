import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findSetsByUserIdPaginated,
  findSetById,
  findSetByName,
  createSet,
  updateSet,
  deleteSet,
  findCaseSetExecutions,
  findCaseSetExecutionById,
  findCaseSetExecutionItems,
} from '../db/case-sets-web.js';
import { runCaseSet } from '../engine/case-set-executor.js';
import { relativeReportUrl } from '../engine/report-paths.js';

export const caseSetRoutes = Router();
caseSetRoutes.use(authMiddleware);

function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const set = findSetById(id);
  if (!set) {
    res.status(404).json({ code: 404, message: 'Case set not found' });
    return null;
  }
  if (set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return set;
}

// GET /api/case-sets-web
caseSetRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters = {
    name: req.query.name as string | undefined,
    tags: req.query.tags as string | undefined,
    status: req.query.status as string | undefined,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
  };
  const result = findSetsByUserIdPaginated(req.user!.userId, page, pageSize, filters, sort, order);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/case-sets-web
caseSetRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, test_case_ids, tags, status } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const trimmedName = name.trim();
  if (findSetByName(req.user!.userId, trimmedName)) {
    res.status(409).json({ code: 409, message: '已存在同名用例集' });
    return;
  }

  const id = createSet(req.user!.userId, trimmedName, description, test_case_ids, tags, status);
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/case-sets-web/:id
caseSetRoutes.get('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;
  res.json({ code: 200, message: 'ok', data: set });
});

// PUT /api/case-sets-web/:id
caseSetRoutes.put('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;

  const { name, description, test_case_ids, tags, status } = req.body;

  const checkName = name && typeof name === 'string' ? name.trim() : set.name;
  const existingSet = findSetByName(req.user!.userId, checkName);
  if (existingSet && existingSet.id !== set.id) {
    res.status(409).json({ code: 409, message: '已存在同名用例集' });
    return;
  }

  updateSet(set.id, req.user!.userId, { name, description, tags, status, test_case_ids });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/case-sets-web/:id
caseSetRoutes.delete('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;

  deleteSet(set.id, req.user!.userId);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/case-sets-web/:id/execute
caseSetRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;

  const { executedBy } = req.body as { executedBy?: string };
  const executor = executedBy ?? req.user!.account ?? 'unknown';

  // Optional filter to run only selected cases
  let filterCaseIds: number[] | undefined;
  if (Array.isArray(req.body.case_ids)) {
    filterCaseIds = (req.body.case_ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n));
  }

  const environmentId = typeof req.body?.environmentId === 'number' ? req.body.environmentId : undefined;

  try {
    const result = await runCaseSet(set.id, 'web', executor, filterCaseIds, environmentId);
    res.json({
      code: 200,
      message: 'ok',
      data: {
        executionId: result.executionId,
        passed: result.passed,
        failed: result.failed,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[routes:case-sets-web] execute failed setId=${set.id} err="${msg}"`);
    res.status(500).json({ code: 500, message: msg });
  }
});

// GET /api/case-sets-web/:id/executions
caseSetRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;
  const items = findCaseSetExecutions(set.id);
  res.json({ code: 200, message: 'ok', data: items });
});

// GET /api/case-sets-web/:id/executions/:eid
caseSetRoutes.get('/:id/executions/:eid', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;
  const eid = Number(req.params.eid);
  const exec = findCaseSetExecutionById(eid);
  if (!exec || exec.set_id !== set.id) {
    res.status(404).json({ code: 404, message: 'Execution not found' });
    return;
  }
  const items = findCaseSetExecutionItems(eid).map((it) => ({
    ...it,
    report_url: it.report_path && it.case_execution_id
      ? relativeReportUrl('web', it.case_id, it.case_execution_id)
      : null,
  }));
  res.json({ code: 200, message: 'ok', data: { ...exec, items } });
});
