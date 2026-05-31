# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-05-31T12:10:57.078Z
> Files: 181 tracked | Anatomy hits: 0 | Misses: 0

## ../../.claude/plans/

- `jaunty-weaving-babbage.md` — 执行与日志系统重构方案 (~2991 tok)
- `shimmying-fluttering-eich.md` — 完整功能补全 + 隔离原则巩固 (~1053 tok)
- `snoopy-cooking-harbor.md` — API 参数化执行 - 批次合并方案 (~516 tok)

## ../../.claude/projects/-Users-dinghao----auto-test-platform/memory/

- `MEMORY.md` — Auto Test Platform - Session Memory (~401 tok)

## ./

- `.gitignore` — Git ignore rules (~24 tok)
- `.nvmrc` (~1 tok)
- `check-step-158.cjs` — Declares Database (~344 tok)
- `check-steps.cjs` — Declares Database (~249 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `debug-row.cjs` — Declares Database (~164 tok)
- `debug-row2.cjs` — Declares Database (~394 tok)
- `DEPLOYMENT.md` — auto-test-platform 配置指南 (~777 tok)
- `fix-final.cjs` — Declares Database (~333 tok)
- `fix-final2.cjs` — Declares Database (~551 tok)
- `fix-log-data.js` — Declares Database (~450 tok)
- `fix-log-data2.cjs` — Declares Database (~312 tok)
- `fix-log-data3.cjs` — Declares Database (~257 tok)
- `fix-remaining.cjs` — Declares Database (~280 tok)
- `index.html` — Auto Test Platform (~84 tok)
- `package-lock.json` — npm lock file (~47394 tok)
- `package.json` — Node.js package manifest (~498 tok)
- `tsconfig.client.json` (~140 tok)
- `tsconfig.server.json` (~124 tok)
- `vite.config.ts` — Vite build configuration (~62 tok)

## .claude/

- `settings.json` (~441 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## data/

- `app.db-shm` (~8738 tok)

## docs/

- `api-test-user-guide.md` — 接口测试用例功能手册 (~3367 tok)
- `execution-log-system.md` — 执行与日志系统重构总结 (~1130 tok)
- `execution-logs-design.md` — 执行日志表设计文档 (~1869 tok)
- `execution-logs-test-report.md` — 执行日志系统功能检查报告 (~1936 tok)
- `scenario-user-guide.md` — 场景列表功能手册 (~3441 tok)

## scripts/

- `dev.mjs` — API routes: GET (1 endpoints) (~216 tok)

## src/client/

- `App.css` — Styles: 65 rules, 30 vars (~2702 tok)
- `App.tsx` — App (~2789 tok)
- `main.tsx` (~68 tok)
- `vite-env.d.ts` — / <reference types="vite/client" /> (~11 tok)

## src/client/components/

- `ApiExecutionTimeline.tsx` — LOG_TYPE_LABELS (~3480 tok)
- `Header.css` — Styles: 27 rules (~1004 tok)
- `Header.tsx` — Header — uses useNavigate, useState, useEffect (~1034 tok)
- `HelpModal.css` — Styles: 24 rules (~915 tok)
- `HomeLayout.css` — Styles: 1 rules (~35 tok)
- `HomeLayout.tsx` — HomeLayout (~55 tok)
- `InlineEdit.css` — Styles: 19 rules (~676 tok)
- `InlineEdit.tsx` — ── InlineText ── (~1060 tok)
- `Layout.css` — Styles: 40 rules (~1497 tok)
- `Layout.tsx` — SVG icons for nav items (~3383 tok)
- `MessageModal.css` — Styles: 9 rules (~338 tok)
- `MessageModal.tsx` — MessageModal (~204 tok)
- `PrePostActionItem.tsx` — defaultAction (~3418 tok)
- `ProtectedRoute.tsx` — ProtectedRoute (~114 tok)
- `ScenarioExecutionTimeline.tsx` — When multiple scenario executions share the same timeline (e.g. in batch mode), (~2559 tok)
- `SelectFunctionModal.css` — Styles: 26 rules (~990 tok)
- `TagFilterSelect.css` — Styles: 19 rules (~632 tok)
- `TagFilterSelect.tsx` — TagFilterSelect (~871 tok)
- `TagInput.css` — Styles: 44 rules (~1561 tok)
- `TagInput.tsx` — 标签选择器：点击弹出下拉框选择标签 (~1573 tok)
- `TestTypeModal.css` — Styles: 11 rules (~367 tok)
- `TestTypeModal.tsx` — TEST_TYPES — uses useNavigate (~411 tok)

## src/client/contexts/

- `AuthContext.tsx` — AuthContext — uses useContext, useState, useEffect (~1174 tok)

## src/client/pages/

- `ApiTestHome.css` — Styles: 35 rules (~1121 tok)
- `ApiTestHome.tsx` — formatDuration — renders table (~2255 tok)
- `Auth.css` — Styles: 35 rules (~1093 tok)
- `ChangePassword.tsx` — ChangePassword — renders form (~796 tok)
- `ForgotPassword.tsx` — ForgotPassword — renders form (~925 tok)
- `Home.css` — Styles: 41 rules (~1407 tok)
- `Home.tsx` — LogoSvg (~2921 tok)
- `Login.tsx` — LogoSvg — renders form (~896 tok)
- `Placeholder.tsx` — Placeholder (~117 tok)
- `Profile.css` — Styles: 28 rules (~1049 tok)
- `Profile.tsx` — Profile — renders form — uses useState, useEffect (~1733 tok)
- `Register.tsx` — Register — renders form (~1155 tok)

## src/client/pages/api-test/

- `ApiDetail.css` — Styles: 106 rules (~11198 tok)
- `ApiDetail.tsx` — getDatabasesFromEnv (~16452 tok)
- `ApiList.css` — Styles: 110 rules (~4866 tok)
- `ApiList.tsx` — STATUSES — renders form, table (~2892 tok)
- `BatchExecutionView.tsx` — Initial active row index (for jumping to specific member) (~381 tok)

## src/client/pages/batch-report/

- `BatchReportDetail.css` — Styles: 75 rules (~2307 tok)
- `BatchReportDetail.tsx` — BatchReportDetail (~6326 tok)
- `BatchReportList.css` — Styles: 44 rules (~1365 tok)
- `BatchReportList.tsx` — BatchReportList — renders form, table (~2782 tok)

## src/client/pages/environment/

- `EnvironmentDetail.css` — Styles: 63 rules (~2387 tok)
- `EnvironmentDetail.tsx` — Database entry type (matches backend) (~4103 tok)
- `EnvironmentList.css` — Styles: 34 rules (~1144 tok)
- `EnvironmentList.tsx` — EnvironmentList — renders table (~1664 tok)

## src/client/pages/mobile-test/

- `MobileTestDetail.css` — Styles: 61 rules (~1965 tok)
- `MobileTestDetail.tsx` — TABS (~5680 tok)
- `MobileTestHome.css` — Styles: 12 rules (~404 tok)
- `MobileTestHome.tsx` — formatDuration — renders table (~2214 tok)
- `MobileTestList.css` — Styles: 50 rules (~1436 tok)
- `MobileTestList.tsx` — PLATFORMS — renders form, table (~1783 tok)

## src/client/pages/mock/

- `MockDetail.css` — Styles: 74 rules (~2668 tok)
- `MockDetail.tsx` — TABS (~4557 tok)
- `MockList.css` — Styles: 60 rules (~2012 tok)
- `MockList.tsx` — MockList — renders form, table (~2237 tok)

## src/client/pages/openapi/

- `OpenAPIImportModal.tsx` — OpenAPIImportModal (~2554 tok)

## src/client/pages/pc-test/

- `PcCaseDetail.css` — Styles: 95 rules (~3764 tok)
- `PcCaseDetail.tsx` — ── Types ── (~6380 tok)
- `PcCaseList.css` — Stylesheet (~7 tok)
- `PcCaseList.tsx` — STATUSES — renders form, table (~1658 tok)
- `PcTestHome.css` — Styles: 12 rules (~404 tok)
- `PcTestHome.tsx` — formatDuration — renders table (~2192 tok)

## src/client/pages/scenario-set/

- `ScenarioSetDetail.css` — Styles: 118 rules (~5922 tok)
- `ScenarioSetDetail.tsx` — STATUS_OPTIONS (~8154 tok)
- `ScenarioSetList.css` — Styles: 15 rules (~507 tok)
- `ScenarioSetList.tsx` — STATUS_MAP — renders form, table (~2569 tok)

## src/client/pages/scenario/

- `ExecutionResultPanel.tsx` — tryFormatJson (~4014 tok)
- `NodeConfigPanel.tsx` — Rich variable info with source tracking (~4944 tok)
- `ScenarioBatchExecutionView.tsx` — ScenarioBatchExecutionView (~366 tok)
- `ScenarioDetail.css` — Styles: 106 rules (~9629 tok)
- `ScenarioDetail.tsx` — nodeTypes (~11276 tok)
- `ScenarioList.css` — Styles: 2 rules (~52 tok)
- `ScenarioList.tsx` — STATUSES — renders form, table (~2766 tok)

## src/client/pages/scenario/nodes/

- `ApiNode.tsx` — ApiNode (~308 tok)
- `ConditionNode.tsx` — ConditionNode (~417 tok)
- `EndNode.tsx` — EndNode (~112 tok)
- `NodeStyles.css` — Styles: 31 rules (~877 tok)
- `StartNode.tsx` — StartNode (~114 tok)

## src/client/pages/schedule/

- `ScheduleDetail.css` — Styles: 29 rules (~959 tok)
- `ScheduleDetail.tsx` — CRON_PRESETS (~2749 tok)
- `ScheduleList.css` — Styles: 16 rules (~444 tok)
- `ScheduleList.tsx` — STATUS_LABELS — renders form (~4646 tok)

## src/client/pages/system/

- `SystemConfig.css` — Styles: 33 rules (~1011 tok)

## src/client/pages/web-test/

- `WebCaseDetail.css` — Styles: 92 rules (~4829 tok)
- `WebCaseDetail.tsx` — ── Types ── (~7651 tok)
- `WebCaseList.tsx` — STATUSES — renders form, table (~1712 tok)
- `WebReportDetail.css` — Styles: 32 rules (~940 tok)
- `WebReportDetail.tsx` — MOCK_DETAIL — renders table (~1519 tok)
- `WebScenarioDetail.css` — Styles: 30 rules (~900 tok)
- `WebScenarioDetail.tsx` — WebScenarioDetail — SVG flow canvas, mock data, execution result table (~4200 tok)
- `WebScheduleDetail.css` — Styles: 22 rules (~825 tok)
- `WebScheduleDetail.tsx` — CRON_PRESETS (~1591 tok)
- `WebTestHome.css` — Stylesheet (~18 tok)
- `WebTestHome.tsx` — formatDuration — renders table (~1387 tok)

## src/client/types/

- `index.ts` — 参数化行索引（场景级参数化时有效），如 0, 1, 2... (~2891 tok)

## src/client/utils/

- `api.ts` — Exports getToken, setToken, removeToken, getUserInfo + 3 more (~346 tok)
- `datetime.ts` — Convert ISO datetime string to local Chinese format: "2026-05-30 17:13:14" (~322 tok)
- `dialog.ts` — Modal/confirm dialog utilities (~400 tok)

## src/server/

- `index.ts` — API routes: GET (1 endpoints) (~412 tok)

## src/server/auth/

- `jwt.ts` — Exports TokenPayload, signToken, verifyToken (~195 tok)
- `middleware.ts` — Exports authMiddleware (~222 tok)

## src/server/db/

- `apis.ts` — Exports ApiRow, ApiLogRow, AssertionRule, AssertionResult + 19 more (~3385 tok)
- `batch-reports-all.ts` — Get all batch reports for a user across all scenario sets. (~680 tok)
- `batch-reports.ts` — Exports BatchLogRow, BatchReport, saveBatchReport, findReportsBySetId, findReportsByUserIdPaginated (~677 tok)
- `environments.ts` — Exports EnvVariable, Environment, DatabaseEntry, DbConfig + 10 more (~1876 tok)
- `index.ts` — Declares __filename (~6950 tok)
- `mobile-tests.ts` — Exports MobileTestCaseRow, MobileTestLogRow, CreateMobileTestInput, UpdateMobileTestInput + 7 more (~1545 tok)
- `mocks.ts` — Get all mocks for a user (no pagination, for engine lookup). (~1860 tok)
- `pc-cases.ts` — Exports PcCaseRow, CreatePcCaseInput, UpdatePcCaseInput, PcCaseLogRow + 7 more (~1526 tok)
- `scenario-sets-web.ts` — Exports ScenarioSetRow, ScenarioSetItem, findSetsByUserIdPaginated, findSetsByUserId + 4 more (~1224 tok)
- `scenario-sets.ts` — Exports ScenarioSetRow, ScenarioSetItem, findSetsByUserIdPaginated, findSetsByUserId + 4 more (~1555 tok)
- `scenarios-web.ts` — Exports ScenarioRow, ScenarioNodeRow, ScenarioEdgeRow, ScenarioLogRow + 12 more (~1869 tok)
- `scenarios.ts` — ── Row interfaces ── (~4547 tok)
- `schedules.ts` — ── Schedule interfaces ── (~3021 tok)
- `users.ts` — Exports AccountType, UserRow, detectAccountType, findUserByAccount + 4 more (~660 tok)
- `web-cases.ts` — Exports WebCaseRow, CreateWebCaseInput, UpdateWebCaseInput, listWebCases + 7 more (~1710 tok)

## src/server/engine/

- `api-executor.ts` — Scenario-level param row index (passed from scenario execution loop) (~8091 tok)
- `batch-executor.ts` — Batch execution engine — runs multiple scenarios sequentially. (~1167 tok)
- `executor.ts` — Exports executeScenario (~6630 tok)
- `mobile-executor.ts` — Mobile test executor - Android/iOS automation via Midscene (~3192 tok)
- `pc-executor.ts` — PC test executor - browser automation via Playwright + Midscene (~2514 tok)
- `web-executor.ts` — Web test executor - browser automation via Playwright + Midscene AI (~2557 tok)

## src/server/routes/

- `apis.ts` — API routes: GET, POST, PUT, DELETE (6 endpoints) (~4605 tok)
- `auth.ts` — API routes: POST, GET, PUT (8 endpoints) (~2147 tok)
- `batch-reports.ts` — API routes: GET (2 endpoints) (~603 tok)
- `environments.ts` — API routes: GET, POST, PUT, DELETE (7 endpoints) (~1200 tok)
- `index.ts` — API routes: GET (1 endpoints) (~628 tok)
- `mobile-tests.ts` — API routes: GET, POST, PUT, DELETE (7 endpoints) (~1338 tok)
- `mocks.ts` — API routes: GET, POST, PUT, DELETE (6 endpoints) (~1033 tok)
- `pc-cases.ts` — API routes: GET, POST, PUT, DELETE (7 endpoints) (~1663 tok)
- `scenario-sets-web.ts` — API routes: GET, POST, PUT, DELETE (5 endpoints) (~802 tok)
- `scenario-sets.ts` — API routes: GET, POST, PUT, DELETE (9 endpoints) (~1757 tok)
- `scenarios-mobile.ts` — API routes: GET, POST, PUT, DELETE (8 endpoints) (~1337 tok)
- `scenarios-pc.ts` — API routes: GET, POST, PUT, DELETE (8 endpoints) (~1324 tok)
- `scenarios-web.ts` — API routes: GET, POST, PUT, DELETE (8 endpoints) (~1328 tok)
- `scenarios.ts` — API routes: GET, POST, PUT, DELETE (10 endpoints) (~2039 tok)
- `schedule-sets.ts` — API routes: GET, PUT, POST (7 endpoints) (~1535 tok)
- `schedules.ts` — API routes: GET, PUT, POST (7 endpoints) (~1443 tok)
- `web-cases.ts` — API routes: GET, POST, PUT, DELETE (7 endpoints) (~1802 tok)

## src/server/scheduler/

- `scheduler.ts` — Scheduler — uses node-cron for precise scheduling. (~1326 tok)

## src/server/utils/

- `id.ts` — Simple unique ID generator (similar to snowflake). (~154 tok)
