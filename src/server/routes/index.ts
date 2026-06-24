import { Router, Request, Response } from 'express';
import { authRoutes } from './auth.js';
import { apiRoutes } from './apis.js';
import { scenarioRoutes } from './scenarios.js';
import { envRoutes } from './environments.js';
import { setRoutes } from './scenario-sets.js';
import { caseSetRoutes as caseSetRoutesWeb } from './case-sets-web.js';
import { caseSetRoutes as caseSetRoutesPc } from './case-sets-pc.js';
import { caseSetRoutes as caseSetRoutesMobile } from './case-sets-mobile.js';
import { mockRoutes as mockRoutesApi } from './mocks-api.js';
import { batchReportRoutes as batchReportRoutesApi } from './batch-reports-api.js';
import { batchReportRoutes as batchReportRoutesWeb } from './batch-reports-web.js';
import { batchReportRoutes as batchReportRoutesPc } from './batch-reports-pc.js';
import { batchReportRoutes as batchReportRoutesMobile } from './batch-reports-mobile.js';
import { openapiRoutes } from '../openapi/routes.js';
import { tagRoutes } from '../db/tags.js';
import { mobileTestRoutes } from './mobile-tests.js';
import { mobilePreviewRoutes } from './mobile-preview.js';
import { webCaseRoutes } from './web-cases.js';
import { pcCaseRoutes } from './pc-cases.js';
import { midsceneConfigRoutes } from './midscene-config.js';
import { webBrowserConfigRoutes } from './web-browser-config.js';

import { scheduleSetApiRoutes } from './schedule-sets-api.js';
import { scheduleSetWebRoutes } from './schedule-sets-web.js';
import { scheduleSetPcRoutes } from './schedule-sets-pc.js';
import { scheduleSetMobileRoutes } from './schedule-sets-mobile.js';
import { deviceRoutes } from './devices.js';
import mobileAppRoutes from './mobile-apps.js';
import { agentRoutes } from './agents.js';
import { pcPreviewRoutes } from './pc-preview.js';
import { dashboardRoutes } from './dashboard.js';
import { prefRoutes } from './user-preferences.js';

export const routes = Router();

routes.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug-only: shows the Playwright env var + driver layout so we can see
// what the running process actually sees. Strip after diagnosing the
// "browser doesn't start" issue. The dev server is open to localhost only.
routes.get('/debug/playwright', async (_req: Request, res: Response) => {
  const fs = await import('node:fs/promises');
  const driverPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  let driverEntries: string[] = [];
  let driverExists = false;
  try {
    driverEntries = (await fs.readdir(driverPath)).slice(0, 30);
    driverExists = true;
  } catch (e: any) {
    driverEntries = [`error: ${e.message}`];
  }
  let defaultCache: string[] = [];
  try {
    defaultCache = (await fs.readdir('/Users/dinghao/Library/Caches/ms-playwright')).slice(0, 30);
  } catch {}
  res.json({
    cwd: process.cwd(),
    env_PBP: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
    driverExists,
    driverEntries,
    defaultCache,
    // resolved location Playwright will actually look at, computed from env
    resolvedChromiumChannelPath: driverPath
      ? `${driverPath}/chromium-1223/chrome-mac-x64/Google Chrome for Testing.app`
      : '~/Library/Caches/ms-playwright/chromium-1223/chrome-mac-x64/Google Chrome for Testing.app',
  });
});

routes.use('/auth', authRoutes);
routes.use('/dashboard', dashboardRoutes);
routes.use('/apis', apiRoutes);
// 接口测试场景（共用表，保持兼容性）
routes.use('/scenarios', scenarioRoutes);
routes.use('/environments', envRoutes);
// 接口测试场景集（共用表，保持兼容性）
routes.use('/scenario-sets', setRoutes);
// Web/PC/Mobile 用例集（独立表，存 test_case_ids）
routes.use('/case-sets-web', caseSetRoutesWeb);
routes.use('/case-sets-pc', caseSetRoutesPc);
routes.use('/case-sets-mobile', caseSetRoutesMobile);
// 接口测试 Mock（独立表）
routes.use('/mocks-api', mockRoutesApi);
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
routes.use('/mobile-apps', mobileAppRoutes);
// 2026-06-08: 移动端实时屏幕预览 — 独立路由挂在 /api/mobile/preview/*,
// 跟 /mobile-tests 平行,只服务 SSE 帧流,不打 mobile-tests 的 CRUD 路由
routes.use('/mobile/preview', mobilePreviewRoutes);
routes.use('/pc/preview', pcPreviewRoutes);
routes.use('/web-cases', webCaseRoutes);
routes.use('/pc-cases', pcCaseRoutes);
routes.use('/devices', deviceRoutes);
// 2026-06-06: agent <-> server comms. Uses its own bearer auth (per-device
// agent_token), not the human JWT — the agentRoutes router applies its own
// agentAuthMiddleware.
routes.use('/agents', agentRoutes);
routes.use('/midscene-config', midsceneConfigRoutes);
routes.use('/web-browser-config', webBrowserConfigRoutes);
routes.use('/user-preferences', prefRoutes);
// 调度 — 按测试类型拆 4 张表
// (api 用 scenario_set_id 列指向 scenario_sets.id;web/pc/mobile 用 case_set_id 列指向各自 case_sets_*.id)
routes.use('/schedule-sets-api', scheduleSetApiRoutes);
routes.use('/schedule-sets-web', scheduleSetWebRoutes);
routes.use('/schedule-sets-pc', scheduleSetPcRoutes);
routes.use('/schedule-sets-mobile', scheduleSetMobileRoutes);

// ── Executor diagnostics: shared-browser state ────────────────────────────
// The web/pc executors each keep a process-level Browser singleton so
// consecutive cases don't pay the ~2-3s Chromium cold-start. These
// endpoints let ops see if a browser is currently running and force-close
// it (useful when the user has finished debugging and wants the window
// gone, or when PBP needs to change).
import { getSharedBrowserInfo as getWebSharedBrowserInfo, closeSharedBrowser as closeWebSharedBrowser } from '../engine/web-executor.js';

routes.get('/executor/shared-browsers', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    message: 'ok',
    data: {
      web: getWebSharedBrowserInfo(),
      // PC 测试已切换到 ComputerAgent(原生桌面),不再使用共享浏览器。
      pc: null,
    },
  });
});

routes.post('/executor/shared-browsers/close', async (_req: Request, res: Response) => {
  console.log('[api] force-close all shared browsers (admin)');
  await closeWebSharedBrowser();
  res.json({ code: 200, message: 'Shared browsers closed', data: { web: null, pc: null } });
});
