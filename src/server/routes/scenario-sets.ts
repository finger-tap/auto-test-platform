import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findSetsByUserIdPaginated,
  findSetsByUserId,
  findSetById,
  createSet,
  updateSet,
  deleteSet,
} from '../db/scenario-sets.js';
import {
  findScenariosByUserId,
  findScenarioSetExecutionsBySetId,
  findScenarioSetExecutionWithItems,
  findScenarioExecutionWithSteps,
} from '../db/scenarios.js';
import { findReportsBySetId } from '../db/batch-reports.js';
import { findUserById } from '../db/users.js';

export const setRoutes = Router();
setRoutes.use(authMiddleware);

function checkOwnership(req: Request, res: Response, setId: number) {
  if (!setId) { res.status(400).json({ code: 400, message: 'Invalid id' }); return null; }
  const set = findSetById(setId);
  if (!set) { res.status(404).json({ code: 404, message: 'Not found' }); return null; }
  if (set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return null; }
  return set;
}

// GET /api/scenario-sets
setRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters = {
    name: req.query.name as string,
    tags: req.query.tags as string,
    status: req.query.status as string,
    test_type: req.query.test_type as string,
  };
  const result = findSetsByUserIdPaginated(req.user!.userId, page, pageSize, filters, sort, order);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/scenario-sets
setRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, scenario_ids, tags, status, test_type } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }
  const id = createSet(req.user!.userId, name.trim(), description, scenario_ids || [], tags, status, test_type || 'api');
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/scenario-sets/:id
setRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const testType = req.query.test_type as string | undefined;
  const set = checkOwnership(req, res, id);
  if (!set) return;

  let scenarioIds: number[] = [];
  try { scenarioIds = JSON.parse(set.scenario_ids || '[]'); } catch { scenarioIds = []; }

  const allScenarios = findScenariosByUserId(req.user!.userId, testType);
  const scenariosInSet = allScenarios.filter(s => scenarioIds.includes(s.id));

  res.json({
    code: 200,
    message: 'ok',
    data: { ...set, scenario_ids: scenarioIds, scenarios: scenariosInSet },
  });
});

// PUT /api/scenario-sets/:id
setRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const { name, description, scenario_ids, tags, status, test_type } = req.body;
  updateSet(id, req.user!.userId, { name, description, scenario_ids, tags, status, test_type });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/scenario-sets/:id
setRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;
  deleteSet(id, req.user!.userId);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/scenario-sets/:id/execute — batch run
setRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  try {
    const { runBatch } = await import('../engine/batch-executor.js');
    const environmentId = req.body.environmentId ? Number(req.body.environmentId) : undefined;

    const result = await runBatch(id, executedBy, environmentId);
    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Execution failed';
    res.status(500).json({ code: 500, message: errorMsg });
  }
});

// GET /api/scenario-sets/:id/executions — list all execution sessions
setRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const executions = findScenarioSetExecutionsBySetId(id, limit);
  res.json({ code: 200, message: 'ok', data: executions });
});

// GET /api/scenario-sets/:id/executions/:execId — get execution detail with scenario execution steps
setRoutes.get('/:id/executions/:execId', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const execId = Number(req.params.execId);
  const set = checkOwnership(req, res, id);
  if (!set) return;
  if (!execId) { res.status(400).json({ code: 400, message: 'Invalid execId' }); return; }

  const detail = findScenarioSetExecutionWithItems(execId);
  if (!detail) { res.status(404).json({ code: 404, message: 'Execution not found' }); return; }

  // Enrich each item with scenario execution steps and api links
  if (detail.items) {
    for (const item of detail.items) {
      if (item.scenario_execution_id) {
        const scenarioDetail = findScenarioExecutionWithSteps(item.scenario_execution_id);
        if (scenarioDetail) {
          (item as any).scenario_execution = scenarioDetail;
        }
      }
    }
  }

  res.json({ code: 200, message: 'ok', data: detail });
});

// GET /api/scenario-sets/:id/reports
setRoutes.get('/:id/reports', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const reports = findReportsBySetId(id, limit);

  const parsed = reports.map(r => {
    try {
      const reportObj = JSON.parse(r.report);
      return {
        id: r.id, passed: r.passed, failed: r.failed,
        total_duration_ms: r.total_duration_ms, executed_by: r.executed_by, executed_at: r.executed_at,
        ...reportObj,
      };
    } catch {
      return { id: r.id, passed: r.passed, failed: r.failed, total_duration_ms: r.total_duration_ms, executed_by: r.executed_by, executed_at: r.executed_at };
    }
  });

  res.json({ code: 200, message: 'ok', data: parsed });
});
