import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { findAllBatchReportsByUserIdPaginated, findBatchReportById } from '../db/batch-reports-all.js';

export const batchReportRoutes = Router();
batchReportRoutes.use(authMiddleware);

// GET /api/batch-reports?page=1&pageSize=10
batchReportRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const testType = req.query.test_type as string | undefined;
  const result = findAllBatchReportsByUserIdPaginated(req.user!.userId, page, pageSize, testType);

  const items = result.items.map(r => {
    try {
      const report = JSON.parse(r.report);
      return {
        id: r.id,
        set_id: r.set_id,
        set_name: r.set_name,
        passed: r.passed,
        failed: r.failed,
        total_duration_ms: r.total_duration_ms,
        executed_by: r.executed_by,
        executed_at: r.executed_at,
        scenarios: report.scenarios || [],
      };
    } catch {
      return { id: r.id, set_id: r.set_id, set_name: r.set_name, passed: r.passed, failed: r.failed, total_duration_ms: r.total_duration_ms, executed_by: r.executed_by, executed_at: r.executed_at, scenarios: [] };
    }
  });

  res.json({
    code: 200,
    message: 'ok',
    data: {
      items,
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    },
  });
});

// GET /api/batch-reports/:id
batchReportRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const testType = req.query.test_type as string | undefined;
  const row = findBatchReportById(id, req.user!.userId, testType);
  if (!row) {
    res.status(404).json({ code: 404, message: 'Report not found' });
    return;
  }
  try {
    const report = JSON.parse(row.report);
    res.json({ code: 200, message: 'ok', data: { ...row, ...report } });
  } catch {
    res.json({ code: 200, message: 'ok', data: row });
  }
});