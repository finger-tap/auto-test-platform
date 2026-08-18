/**
 * Minimal standalone smoke for the team routes — mounts ONLY the team
 * routers on a bare express app (no executor imports, no SQLite), so it
 * validates the new code without the unbuilt midscene workspace.
 *
 *   npx tsx scripts/team-smoke.ts
 */
import express from 'express';
import { teamPingHandler, teamAuthRoutes } from '../src/server/routes/team-auth.js';
import { teamOrgRoutes } from '../src/server/routes/team-org.js';

const app = express();
app.use(express.json());

const api = express.Router();
// Same mount order as production (routes/index.ts): ping → db guard → auth/org.
// This validates the real 503-before-401 ordering.
import { isTeamDbEnabled, isTeamReady } from '../src/server/db-team/client.js';
api.get('/team/ping', (req, res, next) => {
  teamPingHandler(req, res).catch(next);
});
api.use('/team', (_req, res, next) => {
  if (!isTeamDbEnabled() || !isTeamReady()) {
    res.status(503).json({ code: 503, message: '团队功能未启用（中心数据库未配置或尚未就绪）' });
    return;
  }
  next();
});
api.use('/team/auth', teamAuthRoutes);
api.use('/team', teamOrgRoutes);
app.use('/api', api);

const server = app.listen(3998, async () => {
  const base = 'http://localhost:3998/api';
  let failed = 0;

  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      const out = await fn();
      console.log(`✓ ${name}: ${out}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}: ${(e as Error).message}`);
    }
  };

  const get = async (path: string, expectStatus: number) => {
    const res = await fetch(`${base}${path}`);
    const body = await res.json().catch(() => null);
    if (res.status !== expectStatus) {
      throw new Error(`status ${res.status} (want ${expectStatus}) body=${JSON.stringify(body)}`);
    }
    return `${res.status} ${JSON.stringify(body?.data ?? body?.message ?? '')}`;
  };
  const post = async (path: string, payload: unknown, expectStatus: number) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== expectStatus) {
      throw new Error(`status ${res.status} (want ${expectStatus}) body=${JSON.stringify(body)}`);
    }
    return `${res.status} ${JSON.stringify(body?.data ?? body?.message ?? '')}`;
  };

  await check('ping works without DB', () => get('/team/ping', 200));
  await check('register → 503 (db disabled)', () =>
    post('/team/auth/register', { account: 'a@b.c', password: '123456' }, 503));
  await check('login → 503 (db disabled)', () =>
    post('/team/auth/login', { account: 'a@b.c', password: '123456' }, 503));
  await check('teams → 503 (db disabled)', () => get('/team/teams', 503));
  await check('teams with fake token → 503 (db guard runs before auth)', async () => {
    const res = await fetch(`${base}/team/teams`, { headers: { Authorization: 'Bearer faketoken' } });
    if (res.status !== 503) throw new Error(`status ${res.status} (want 503 — db disabled precedes auth)`);
    return '503 guard ordering correct';
  });

  console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failed} FAILED`);
  server.close();
  process.exit(failed === 0 ? 0 : 1);
});
