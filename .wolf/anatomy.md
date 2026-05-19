# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-05-17T04:23:31.275Z
> Files: 82 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.gitignore` — Git ignore rules (~24 tok)
- `.nvmrc` (~1 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `index.html` — Auto Test Platform (~84 tok)
- `package-lock.json` — npm lock file (~47394 tok)
- `package.json` — Node.js package manifest (~376 tok)
- `tsconfig.client.json` (~140 tok)
- `tsconfig.server.json` (~124 tok)
- `vite.config.ts` — Vite build configuration (~62 tok)

## .claude/

- `settings.json` (~441 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## data/

- `app.db-shm` (~8738 tok)

## scripts/

- `dev.mjs` — API routes: GET (1 endpoints) (~202 tok)

## src/client/

- `App.css` — Styles: 2 vars (~65 tok)
- `App.tsx` — App (~678 tok)
- `main.tsx` (~68 tok)
- `vite-env.d.ts` — / <reference types="vite/client" /> (~11 tok)

## src/client/components/

- `Header.css` — Styles: 26 rules (~949 tok)
- `Header.tsx` — Header — uses useNavigate, useState, useEffect (~1034 tok)
- `HomeLayout.css` — Styles: 2 rules (~59 tok)
- `HomeLayout.tsx` — HomeLayout (~85 tok)
- `InlineEdit.css` — Styles: 11 rules (~304 tok)
- `InlineEdit.tsx` — ── InlineText ── (~1060 tok)
- `Layout.css` — Styles: 28 rules (~1042 tok)
- `Layout.tsx` — MENUS — uses useNavigate, useState, useEffect (~885 tok)
- `MessageModal.css` — Styles: 9 rules (~310 tok)
- `MessageModal.tsx` — MessageModal (~204 tok)
- `ProtectedRoute.tsx` — ProtectedRoute (~114 tok)
- `TestTypeModal.css` — Styles: 11 rules (~346 tok)
- `TestTypeModal.tsx` — TEST_TYPES — uses useNavigate (~411 tok)

## src/client/contexts/

- `AuthContext.tsx` — AuthContext — uses useContext, useState, useEffect (~1174 tok)

## src/client/pages/

- `Auth.css` — Styles: 24 rules (~654 tok)
- `ChangePassword.tsx` — ChangePassword — renders form — uses useState, useNavigate (~765 tok)
- `ForgotPassword.tsx` — ForgotPassword — renders form — uses useState, useNavigate (~773 tok)
- `Home.css` — Styles: 6 rules (~155 tok)
- `Home.tsx` — Home — uses useState (~234 tok)
- `Login.tsx` — Login — renders form — uses useState, useNavigate (~682 tok)
- `Placeholder.tsx` — Placeholder (~117 tok)
- `Profile.css` — Styles: 28 rules (~995 tok)
- `Profile.tsx` — Profile — renders form — uses useState, useEffect (~1733 tok)
- `Register.tsx` — Register — renders form — uses useState, useNavigate (~1161 tok)

## src/client/pages/api-test/

- `ApiDetail.css` — Styles: 120 rules, 1 animations (~3314 tok)
- `ApiDetail.tsx` — METHODS (~9384 tok)
- `ApiList.css` — Styles: 70 rules (~1868 tok)
- `ApiList.tsx` — STATUSES — renders table — uses useState, useNavigate, useEffect (~2215 tok)

## src/client/pages/environment/

- `EnvironmentList.css` — Styles: 48 rules (~1355 tok)
- `EnvironmentList.tsx` — EnvironmentList — uses useState, useEffect (~2467 tok)

## src/client/pages/scenario/

- `ExecutionResultPanel.tsx` — tryFormatJson — uses useState, useMemo (~3424 tok)
- `NodeConfigPanel.tsx` — NodeConfigPanel — uses useState, useEffect (~3299 tok)
- `ScenarioDetail.css` — Styles: 119 rules (~4221 tok)
- `ScenarioDetail.tsx` — nodeTypes (~4869 tok)
- `ScenarioList.css` — Styles: 2 rules (~52 tok)
- `ScenarioList.tsx` — STATUSES — renders table — uses useNavigate, useState, useEffect (~2233 tok)

## src/client/pages/scenario/nodes/

- `ApiNode.tsx` — ApiNode (~308 tok)
- `ConditionNode.tsx` — ConditionNode (~417 tok)
- `EndNode.tsx` — EndNode (~112 tok)
- `NodeStyles.css` — Styles: 31 rules, 1 animations (~823 tok)
- `StartNode.tsx` — StartNode (~114 tok)

## src/client/pages/schedule/

- `ScheduleDetail.css` — Styles: 29 rules (~901 tok)
- `ScheduleDetail.tsx` — CRON_PRESETS — uses useParams, useNavigate, useState, useEffect (~2650 tok)
- `ScheduleList.css` — Styles: 13 rules (~252 tok)
- `ScheduleList.tsx` — STATUS_LABELS — uses useState, useEffect, useNavigate (~5539 tok)

## src/client/types/

- `index.ts` — Exports EnvVariable, Environment, UserInfo, LoginResponse + 13 more (~1030 tok)

## src/client/utils/

- `api.ts` — Exports getToken, setToken, removeToken, getUserInfo + 3 more (~346 tok)

## src/server/

- `index.ts` — API routes: GET (1 endpoints) (~412 tok)

## src/server/auth/

- `jwt.ts` — Exports TokenPayload, signToken, verifyToken (~195 tok)
- `middleware.ts` — Exports authMiddleware (~222 tok)

## src/server/db/

- `apis.ts` — Exports ApiRow, ApiLogRow, AssertionRule, CreateApiInput + 9 more (~1336 tok)
- `environments.ts` — Exports EnvVariable, Environment, findEnvsByUserId, findEnvById + 5 more (~981 tok)
- `index.ts` — Declares __filename (~1987 tok)
- `scenarios.ts` — ── Row interfaces ── (~1770 tok)
- `schedules.ts` — ── Schedule interfaces ── (~2756 tok)
- `users.ts` — Exports AccountType, UserRow, detectAccountType, findUserByAccount + 4 more (~660 tok)

## src/server/engine/

- `api-executor.ts` — Exports ApiExecutionResult, executeApi, extractValue, evaluateAssertions (~1787 tok)
- `executor.ts` — Exports executeScenario (~4416 tok)

## src/server/routes/

- `apis.ts` — API routes: GET, POST, PUT, DELETE (7 endpoints) (~2287 tok)
- `auth.ts` — API routes: POST, GET, PUT (8 endpoints) (~2147 tok)
- `environments.ts` — API routes: GET, POST, PUT, DELETE (5 endpoints) (~740 tok)
- `index.ts` — API routes: GET (1 endpoints) (~180 tok)
- `scenarios.ts` — API routes: GET, POST, PUT, DELETE (8 endpoints) (~1326 tok)
- `schedules.ts` — API routes: GET, PUT, POST (7 endpoints) (~1367 tok)

## src/server/scheduler/

- `scheduler.ts` — Scheduler — polls for due schedules and triggers scenario execution. (~962 tok)
