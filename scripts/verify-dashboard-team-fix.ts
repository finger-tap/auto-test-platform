/**
 * Regression check for the 2026-08-25 login auth bug ("登录之后还是提示未认证").
 *
 * Root cause being verified:
 *  1. team token + X-Team-Id but NO X-Project-Id used to fall through the
 *     dispatcher's dashboard branch and hit the LOCAL dashboard route, whose
 *     authMiddleware rejects team tokens → 401 everywhere. Fixed: dashboard
 *     now returns team-mode zeros whenever the request is a team request.
 *  2. Resource paths (scenarios/...) with no project selected must give the
 *     explicit 400 "缺少项目上下文", NOT a misleading 401.
 *
 * Run: npx tsx scripts/verify-dashboard-team-fix.ts   (needs .env DB_URL +
 * TiDB reachable only for the membership probe; assertions a/b/c/d need no DB.)
 */
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import { teamResourceDispatcher } from '../src/server/routes/team-resources.js';
import { signTeamToken } from '../src/server/auth/team-jwt.js';
import { setTeamReady } from '../src/server/db-team/client.js';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}
if (!process.env.DB_URL) {
  console.error('✗ 需要 .env 里的 DB_URL（dispatcher 入口要求团队库启用）');
  process.exit(1);
}
// dashboard 零值分支不查库；membership 探测走真实 TiDB。迁移早已应用，
// 这里直接标记 ready（与 server 启动后的稳态一致）。
setTeamReady(true);

const FAKE_USER = 9_999_999; // 不会是任何真实团队成员
const token = signTeamToken({ userId: FAKE_USER, account: 'verify-script' });

const app = express();
app.use('/api', teamResourceDispatcher);
// mock 本地路由：dashboard 本地版与 scenarios 本地版都打上标记返回 —
// 如果团队请求"穿透"到这里，就说明修复失效（修复前 dashboard 会穿到
// 本地 authMiddleware 的 401，无法与真实 401 区分，这里直接用 599 标记）。
app.get('/api/dashboard/*', (_q, res) => res.status(599).json({ code: 599, message: 'LEAKED-TO-LOCAL' }));
app.get('/api/dashboard', (_q, res) => res.status(599).json({ code: 599, message: 'LEAKED-TO-LOCAL' }));
app.get('/api/scenarios', (_q, res) => res.status(599).json({ code: 599, message: 'LEAKED-TO-LOCAL' }));

let failed = 0;
async function check(name: string, fetchFn: () => Promise<Response>, expect: { status: number; bodyIncludes?: string; bodyExcludes?: string }) {
  const res = await fetchFn();
  const text = await res.text();
  const ok =
    res.status === expect.status &&
    (!expect.bodyIncludes || text.includes(expect.bodyIncludes)) &&
    (!expect.bodyExcludes || !text.includes(expect.bodyExcludes));
  console.log(`${ok ? '✓' : '✗'} ${name}  [HTTP ${res.status}] ${text.slice(0, 120)}`);
  if (!ok) failed++;
}

const base = 'http://127.0.0.1:3991/api';
const server = app.listen(3991);

try {
  // a. 修复目标：团队 token + 团队头 + 无项目头 → dashboard 返回零值（修复前 401）
  await check('dashboard 无项目头 → 团队零值(200)', () =>
    fetch(`${base}/dashboard/stats`, { headers: { Authorization: `Bearer ${token}`, 'X-Team-Id': '1' } }),
    { status: 200, bodyExcludes: 'LEAKED-TO-LOCAL' });

  // b. 带项目头 → 零值（原有行为保持）
  await check('dashboard 带项目头 → 团队零值(200)', () =>
    fetch(`${base}/dashboard/recent-executions?limit=5`, { headers: { Authorization: `Bearer ${token}`, 'X-Team-Id': '1', 'X-Project-Id': '1' } }),
    { status: 200 });

  // c. 无团队头（本地模式）→ 穿透到本地路由（原行为保持）
  await check('dashboard 无团队头 → 穿透本地(599)', () =>
    fetch(`${base}/dashboard/stats`),
    { status: 599, bodyIncludes: 'LEAKED-TO-LOCAL' });

  // d. 资源路径无项目头 → 明确 400 缺项目上下文（而非误导性 401）
  await check('scenarios 无项目头 → 400 缺项目上下文', () =>
    fetch(`${base}/scenarios?page=1&pageSize=1`, { headers: { Authorization: `Bearer ${token}`, 'X-Team-Id': '1' } }),
    { status: 400, bodyIncludes: '缺少项目上下文', bodyExcludes: 'LEAKED-TO-LOCAL' });

  // e. 资源路径带假项目头 → 404 非成员（不穿透本地）
  await check('scenarios 假项目头 → 404 非成员', () =>
    fetch(`${base}/scenarios?page=1&pageSize=1`, { headers: { Authorization: `Bearer ${token}`, 'X-Team-Id': '1', 'X-Project-Id': '1' } }),
    { status: 404, bodyIncludes: '团队不存在或你不是该团队成员', bodyExcludes: 'LEAKED-TO-LOCAL' });

  // f. 本地 token（伪造的非团队 JWT）→ dispatcher 无视, 穿透本地（保持）
  await check('非团队 token → 穿透本地(599)', () =>
    fetch(`${base}/dashboard/stats`, { headers: { Authorization: 'Bearer not-a-team-jwt', 'X-Team-Id': '1' } }),
    { status: 599, bodyIncludes: 'LEAKED-TO-LOCAL' });
} finally {
  server.close();
}

console.log(failed === 0 ? '\nALL DASHBOARD-FIX CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
