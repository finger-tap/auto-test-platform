import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findSetsByUserIdPaginated,
  findSetById,
  createSet,
  updateSet,
  deleteSet,
} from '../db/scenario-sets-mobile.js';

export const scenarioSetRoutes = Router();
scenarioSetRoutes.use(authMiddleware);

function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const set = findSetById(id);
  if (!set) {
    res.status(404).json({ code: 404, message: 'Scenario set not found' });
    return null;
  }
  if (set.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return set;
}

// GET /api/scenario-sets-mobile
scenarioSetRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters = {
    name: req.query.name as string | undefined,
    tags: req.query.tags as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = findSetsByUserIdPaginated(req.user!.userId, page, pageSize, filters, sort, order);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/scenario-sets-mobile
scenarioSetRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, scenario_ids, tags, status } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const id = createSet(req.user!.userId, name.trim(), description, scenario_ids, tags, status);
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/scenario-sets-mobile/:id
scenarioSetRoutes.get('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;
  res.json({ code: 200, message: 'ok', data: set });
});

// PUT /api/scenario-sets-mobile/:id
scenarioSetRoutes.put('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;

  const { name, description, scenario_ids, tags, status } = req.body;
  updateSet(set.id, req.user!.userId, { name, description, tags, status, scenario_ids });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/scenario-sets-mobile/:id
scenarioSetRoutes.delete('/:id', (req: Request, res: Response) => {
  const set = checkOwnership(req, res);
  if (!set) return;

  deleteSet(set.id, req.user!.userId);
  res.json({ code: 200, message: 'Deleted' });
});
