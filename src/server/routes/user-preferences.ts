import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { getPreference, setPreference } from '../db/user-preferences.js';

export const prefRoutes = Router();
prefRoutes.use(authMiddleware);

// GET /api/user-preferences/:testType
prefRoutes.get('/:testType', (req: Request, res: Response) => {
  const { testType } = req.params;
  const pref = getPreference(req.user!.userId, testType);
  res.json({
    code: 200,
    message: 'ok',
    data: { environmentId: pref?.environment_id ?? null },
  });
});

// PUT /api/user-preferences/:testType
prefRoutes.put('/:testType', (req: Request, res: Response) => {
  const { testType } = req.params;
  const { environmentId } = req.body as { environmentId?: number | null };
  setPreference(req.user!.userId, testType, environmentId ?? null);
  res.json({ code: 200, message: 'ok' });
});
