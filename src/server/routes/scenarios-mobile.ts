import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findScenariosByUserIdPaginated,
  findScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  findNodesByScenarioId,
  upsertNodes,
  findEdgesByScenarioId,
  upsertEdges,
  findLogsByScenarioId,
} from '../db/scenarios-mobile.js';
import { findUserById } from '../db/users.js';

export const scenarioRoutes = Router();
scenarioRoutes.use(authMiddleware);

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

// GET /api/scenarios-mobile
scenarioRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const { items, total } = findScenariosByUserIdPaginated(req.user!.userId, page, pageSize, sort, order);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
});

// POST /api/scenarios-mobile
scenarioRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, status, tags, parameters } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const id = createScenario(req.user!.userId, { name: name.trim(), description, status, tags, parameters });

  upsertNodes(id, [
    { node_id: 'start', type: 'start', position_x: 250, position_y: 50, label: '开始' },
    { node_id: 'end', type: 'end', position_x: 250, position_y: 400, label: '结束' },
  ]);

  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/scenarios-mobile/:id
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

// PUT /api/scenarios-mobile/:id
scenarioRoutes.put('/:id', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const { name, description, status, tags, parameters } = req.body;
  updateScenario(scenario.id, { name, description, status, tags, parameters });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/scenarios-mobile/:id
scenarioRoutes.delete('/:id', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  deleteScenario(scenario.id);
  res.json({ code: 200, message: 'Deleted' });
});

// PUT /api/scenarios-mobile/:id/flow
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

// POST /api/scenarios-mobile/:id/execute
scenarioRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  // Mobile scenario execution not yet implemented - return stub result
  res.json({
    code: 200,
    message: 'ok',
    data: {
      status: 'skipped',
      duration_ms: 0,
      steps: [],
      error_message: 'Mobile scenario execution not yet implemented',
      executed_by: executedBy,
    }
  });
});

// GET /api/scenarios-mobile/:id/logs
scenarioRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const scenario = checkOwnership(req, res);
  if (!scenario) return;

  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByScenarioId(scenario.id, limit);
  const parsedLogs = logs.map(log => ({
    ...log,
    node_results: log.node_results ? JSON.parse(log.node_results) : null,
  }));
  res.json({ code: 200, message: 'ok', data: parsedLogs });
});
