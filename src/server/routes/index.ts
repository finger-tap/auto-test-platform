import { Router, Request, Response } from 'express';
import { authRoutes } from './auth.js';
import { apiRoutes } from './apis.js';

export const routes = Router();

routes.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

routes.use('/auth', authRoutes);
routes.use('/apis', apiRoutes);
