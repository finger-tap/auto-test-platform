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
import { mockRoutes as mockRoutesApi } from './mocks-api.js';
import { mockRoutes as mockRoutesWeb } from './mocks-web.js';
import { mockRoutes as mockRoutesPc } from './mocks-pc.js';
import { mockRoutes as mockRoutesMobile } from './mocks-mobile.js';
import { batchReportRoutes as batchReportRoutesApi } from './batch-reports-api.js';
import { batchReportRoutes as batchReportRoutesWeb } from './batch-reports-web.js';
import { batchReportRoutes as batchReportRoutesPc } from './batch-reports-pc.js';
import { batchReportRoutes as batchReportRoutesMobile } from './batch-reports-mobile.js';
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
// 接口测试 Mock（独立表）
routes.use('/mocks-api', mockRoutesApi);
// Web测试 Mock（独立表）
routes.use('/mocks-web', mockRoutesWeb);
// PC测试 Mock（独立表）
routes.use('/mocks-pc', mockRoutesPc);
// 移动端测试 Mock（独立表）
routes.use('/mocks-mobile', mockRoutesMobile);
// 接口测试批量报告（独立表）
routes.use('/batch-reports-api', batchReportRoutesApi);
// Web测试批量报告（独立表）
routes.use('/batch-reports-web', batchReportRoutesWeb);
// PC测试批量报告（独立表）
routes.use('/batch-reports-pc', batchReportRoutesPc);
// 移动端测试批量报告（独立表）
routes.use('/batch-reports-mobile', batchReportRoutesMobile);
routes.use('/openapi', openapiRoutes);
routes.use('/tags', tagRoutes);
routes.use('/mobile-tests', mobileTestRoutes);
routes.use('/web-cases', webCaseRoutes);
routes.use('/pc-cases', pcCaseRoutes);
