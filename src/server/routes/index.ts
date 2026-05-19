import { Router, Request, Response } from 'express';
import { authRoutes } from './auth.js';
import { apiRoutes } from './apis.js';
import { scenarioRoutes } from './scenarios.js';
import { scheduleRoutes } from './schedules.js';
import { envRoutes } from './environments.js';
import { setRoutes } from './scenario-sets.js';
import { batchReportRoutes } from './batch-reports.js';
import { mockRoutes } from './mocks.js';
import { openapiRoutes } from '../openapi/routes.js';

import { scheduleSetRoutes } from './schedule-sets.js';

export const routes = Router();

routes.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

routes.use('/auth', authRoutes);
routes.use('/apis', apiRoutes);
routes.use('/scenarios', scenarioRoutes);
routes.use('/schedules', scheduleRoutes);
routes.use('/schedule-sets', scheduleSetRoutes);
routes.use('/environments', envRoutes);
routes.use('/scenario-sets', setRoutes);
routes.use('/batch-reports', batchReportRoutes);
routes.use('/mocks', mockRoutes);
routes.use('/openapi', openapiRoutes);