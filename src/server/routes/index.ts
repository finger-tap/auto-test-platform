import { Router, Request, Response } from 'express';
import { authRoutes } from './auth.js';
import { apiRoutes } from './apis.js';
import { scenarioRoutes } from './scenarios.js';
import { scenarioRoutes as scenarioRoutesWeb } from './scenarios-web.js';
import { scenarioRoutes as scenarioRoutesPc } from './scenarios-pc.js';
import { scenarioRoutes as scenarioRoutesMobile } from './scenarios-mobile.js';
import { envRoutes } from './environments.js';
import { setRoutes } from './scenario-sets.js';
import { scenarioSetRoutes as scenarioSetRoutesWeb } from './scenario-sets-web.js';
import { scenarioSetRoutes as scenarioSetRoutesPc } from './scenario-sets-pc.js';
import { scenarioSetRoutes as scenarioSetRoutesMobile } from './scenario-sets-mobile.js';
import { batchReportRoutes } from './batch-reports.js';
import { mockRoutes } from './mocks.js';
import { openapiRoutes } from '../openapi/routes.js';
import { tagRoutes } from '../db/tags.js';
import { mobileTestRoutes } from './mobile-tests.js';
import { webCaseRoutes } from './web-cases.js';
import { pcCaseRoutes } from './pc-cases.js';

import { scheduleSetRoutes } from './schedule-sets.js';

export const routes = Router();

routes.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

routes.use('/auth', authRoutes);
routes.use('/apis', apiRoutes);
// 接口测试场景（共用表，保持兼容性）
routes.use('/scenarios', scenarioRoutes);
// Web测试场景（独立表）
routes.use('/scenarios-web', scenarioRoutesWeb);
// PC测试场景（独立表）
routes.use('/scenarios-pc', scenarioRoutesPc);
// 移动端测试场景（独立表）
routes.use('/scenarios-mobile', scenarioRoutesMobile);
routes.use('/schedule-sets', scheduleSetRoutes);
routes.use('/environments', envRoutes);
// 接口测试场景集（共用表，保持兼容性）
routes.use('/scenario-sets', setRoutes);
// Web测试场景集（独立表）
routes.use('/scenario-sets-web', scenarioSetRoutesWeb);
// PC测试场景集（独立表）
routes.use('/scenario-sets-pc', scenarioSetRoutesPc);
// 移动端测试场景集（独立表）
routes.use('/scenario-sets-mobile', scenarioSetRoutesMobile);
routes.use('/batch-reports', batchReportRoutes);
routes.use('/mocks', mockRoutes);
routes.use('/openapi', openapiRoutes);
routes.use('/tags', tagRoutes);
routes.use('/mobile-tests', mobileTestRoutes);
routes.use('/web-cases', webCaseRoutes);
routes.use('/pc-cases', pcCaseRoutes);