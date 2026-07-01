import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { getPreference, setPreference, getUserSetting, setUserSetting } from '../db/user-preferences.js';

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

// ── 全局用户设置（theme 等，复用 user_preferences 表，test_type 作 key） ──

// GET /api/user-preferences/settings/:key
prefRoutes.get('/settings/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  const value = getUserSetting(req.user!.userId, key);
  res.json({ code: 200, message: 'ok', data: { value } });
});

// PUT /api/user-preferences/settings/:key
prefRoutes.put('/settings/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  const { value } = req.body as { value?: string };
  if (value === undefined || value === null) {
    res.status(400).json({ code: 400, message: 'value is required' });
    return;
  }
  setUserSetting(req.user!.userId, key, value);
  res.json({ code: 200, message: 'ok' });
});
