import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findMocksByUserIdPaginated,
  findMockById,
  createMock,
  updateMock,
  deleteMock,
  resetMockHitCount,
} from '../db/mocks.js';

export const mockRoutes = Router();
mockRoutes.use(authMiddleware);

// Helper
function checkOwnership(req: Request, res: Response, mockId: number) {
  const mock = findMockById(mockId);
  if (!mock) { res.status(404).json({ code: 404, message: 'Mock not found' }); return null; }
  if (mock.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return null; }
  return mock;
}

// GET /api/mocks
mockRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const testType = req.query.test_type as string | undefined;
  const result = findMocksByUserIdPaginated(req.user!.userId, page, pageSize, testType);
  res.json({
    code: 200, message: 'ok',
    data: {
      items: result.items,
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    },
  });
});

// POST /api/mocks
mockRoutes.post('/', (req: Request, res: Response) => {
  const { name, method, path_pattern, description, tags, status, response_status, response_headers, response_body, response_delay_ms, conditions, match_mode, enabled, test_type } = req.body;
  if (!name || !path_pattern) {
    res.status(400).json({ code: 400, message: 'Name and path_pattern are required' });
    return;
  }
  const id = createMock({
    userId: req.user!.userId,
    name, method, path_pattern, description, tags, status,
    response_status, response_headers, response_body,
    response_delay_ms, conditions, match_mode, enabled,
    test_type: test_type || 'api',
  });
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/mocks/:id
mockRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const testType = req.query.test_type as string | undefined;
  const mock = findMockById(id, testType);
  if (!mock || mock.user_id !== req.user!.userId) {
    res.status(404).json({ code: 404, message: 'Mock not found' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: mock });
});

// PUT /api/mocks/:id
mockRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const mock = checkOwnership(req, res, id);
  if (!mock) return;

  const { name, method, path_pattern, description, tags, status, response_status, response_headers, response_body, response_delay_ms, conditions, match_mode, enabled, test_type } = req.body;
  updateMock(id, req.user!.userId, {
    name, method, path_pattern, description, tags, status,
    response_status, response_headers, response_body,
    response_delay_ms, conditions, match_mode,
    enabled,
    test_type,
  });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/mocks/:id
mockRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const mock = checkOwnership(req, res, id);
  if (!mock) return;
  deleteMock(id, req.user!.userId);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/mocks/:id/reset
mockRoutes.post('/:id/reset', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const mock = checkOwnership(req, res, id);
  if (!mock) return;
  resetMockHitCount(id);
  res.json({ code: 200, message: 'Hit count reset' });
});