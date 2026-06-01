import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findScenariosByUserIdPaginated,
  findScenariosByUserId,
  findScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  findNodesByScenarioId,
  upsertNodes,
  findEdgesByScenarioId,
  upsertEdges,
  findScenarioExecutionsByScenarioId,
  findScenarioExecutionWithSteps,
} from '../db/scenarios.js';
import { findUserById } from '../db/users.js';

export const scenarioRoutes = Router();
scenarioRoutes.use(authMiddleware);

// Helper: check ownership
function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const scenario = findScenarioById(id);
  if (!scenario) {
    res.status(404).json({ code: 404, message: 'Scenario not found' });
    return null;
  }
  if (scenario.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return scenario;
}

// GET /api/scenarios
scenarioRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const name = req.query.name as string | undefined;
  const { items, total } = findScenariosByUserIdPaginated(req.user!.userId, page, pageSize, sort, order, name);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
});

// POST /api/scenarios
scenarioRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, status, tags, parameters } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const id = createScenario(req.user!.userId, { name: name.trim(), description, status, tags, parameters });

  // Create default start and end nodes
  upsertNodes(id, [
    { node_id: 'start', type: 'start', position_x: 250, position_y: 50, label: '开始' },
    { node_id: 'end', type: 'end', position_x: 250, position_y: 400, label: '结束' },
  ]);

  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/scenarios/:id
scenarioRoutes.get('/:id', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const nodes = findNodesByScenarioId(scenario.id);
  const edges = findEdgesByScenarioId(scenario.id);

  res.json({
    code: 200,
    message: 'ok',
    data: { scenario, nodes, edges },
  });
});

// PUT /api/scenarios/:id
scenarioRoutes.put('/:id', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const { name, description, status, tags, parameters } = req.body;
  updateScenario(scenario.id, { name, description, status, tags, parameters });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/scenarios/:id
scenarioRoutes.delete('/:id', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  deleteScenario(scenario.id);
  res.json({ code: 200, message: 'Deleted' });
});

// PUT /api/scenarios/:id/flow
scenarioRoutes.put('/:id/flow', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const { nodes, edges } = req.body;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    res.status(400).json({ code: 400, message: 'nodes and edges must be arrays' });
    return;
  }

  upsertNodes(scenario.id, nodes);
  upsertEdges(scenario.id, edges);

  res.json({ code: 200, message: 'Flow saved' });
});

// POST /api/scenarios/:id/execute
scenarioRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  try {
    // Dynamic import to avoid circular dependency
    const { executeScenario } = await import('../engine/executor.js');
    const environmentId = req.body.environmentId ? Number(req.body.environmentId) : undefined;
    const result = await executeScenario(scenario.id, executedBy, environmentId);
    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Execution failed';
    res.status(500).json({ code: 500, message: errorMsg });
  }
});

// GET /api/scenarios/:id/logs — list executions (new table)
scenarioRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const executions = findScenarioExecutionsByScenarioId(scenario.id, limit);
  res.json({ code: 200, message: 'ok', data: executions });
});

// GET /api/scenarios/:id/executions — list all execution sessions, grouped by batch
scenarioRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const executions = findScenarioExecutionsByScenarioId(scenario.id, limit);

  // Group by batch_id: all records with same batch_id are grouped together
  const batchMap = new Map<number, (typeof executions)[0] & { sub_executions?: (typeof executions)[0][] }>();
  for (const exec of executions) {
    if (exec.batch_id === null || exec.batch_id === -1) {
      // Standalone execution (no batch)
      batchMap.set(-exec.id, { ...exec, sub_executions: [] });  // use negative id as key
    } else {
      // Has batch_id: group by batch_id
      if (!batchMap.has(exec.batch_id)) {
        batchMap.set(exec.batch_id, { ...exec, sub_executions: [] });
      } else {
        batchMap.get(exec.batch_id)!.sub_executions!.push(exec);
      }
    }
  }

  const results = Array.from(batchMap.values());

  res.json({ code: 200, message: 'ok', data: results });
});

// GET /api/scenarios/:id/executions/:execId — get execution detail with steps and api links
scenarioRoutes.get('/:id/executions/:execId', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const execId = Number(req.params.execId);
  if (!execId) { res.status(400).json({ code: 400, message: 'Invalid execId' }); return; }

  const detail = findScenarioExecutionWithSteps(execId);
  if (!detail) { res.status(404).json({ code: 404, message: 'Execution not found' }); return; }
  res.json({ code: 200, message: 'ok', data: detail });
});
