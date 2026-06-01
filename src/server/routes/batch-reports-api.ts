import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findBatchReportsByUserIdPaginated,
  findBatchReportById,
  deleteBatchReport,
} from '../db/batch-reports-api.js';

export const batchReportRoutes = Router();
batchReportRoutes.use(authMiddleware);

// GET /api/batch-reports-api
batchReportRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const result = findBatchReportsByUserIdPaginated(req.user!.userId, page, pageSize);
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

// GET /api/batch-reports-api/:id
batchReportRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const report = findBatchReportById(id);
  if (!report) {
    res.status(404).json({ code: 404, message: 'Batch report not found' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: report });
});

// DELETE /api/batch-reports-api/:id
batchReportRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = deleteBatchReport(id);
  if (!ok) {
    res.status(404).json({ code: 404, message: 'Batch report not found' });
    return;
  }
  res.json({ code: 200, message: 'Deleted' });
});
