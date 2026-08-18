/**
 * Minimal standalone smoke for the team routes — mounts ONLY the team
 * routers on a bare express app (no executor imports, no SQLite), so it
 * validates the new code without the midscene workspace build.
 *
 *   npx tsx scripts/team-smoke.ts
 */
import express from 'express';
import { teamPingHandler, teamAuthRoutes } from '../src/server/routes/team-auth.js';
import { teamOrgRoutes } from '../src/server/routes/team-org.js';
import { teamExtrasRoutes } from '../src/server/routes/team-extras.js';
import { teamResourceDispatcher } from '../src/server/routes/team-resources.js';
import { isTeamDbEnabled, isTeamReady } from '../src/server/db-team/client.js';

const app = express();
app.use(express.json());

const api = express.Router();
// Same mount order as production: resource dispatcher first, then ping/guard/org/extras.
api.use(teamResourceDispatcher);
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
api.use('/team', teamExtrasRoutes);
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
    return `${res.status} ${JSON.stringify(body?.data ?? body?.message ?? '').slice(0, 80)}`;
  };
  const req = async (method: string, path: string, payload: unknown, expectStatus: number, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== expectStatus) {
      throw new Error(`status ${res.status} (want ${expectStatus}) body=${JSON.stringify(body)}`);
    }
    return `${res.status} ${JSON.stringify(body?.data ?? body?.message ?? '').slice(0, 80)}`;
  };

  await check('ping works without DB', () => get('/team/ping', 200));
  await check('register → 503 (db disabled)', () => req('POST', '/team/auth/register', { account: 'a@b.c', password: '123456' }, 503));
  await check('login → 503 (db disabled)', () => req('POST', '/team/auth/login', { account: 'a@b.c', password: '123456' }, 503));
  await check('teams → 503 (db disabled)', () => get('/team/teams', 503));
  await check('teams with fake token → 503 (guard before auth)', () => req('GET', '/team/teams', undefined, 503, { Authorization: 'Bearer faketoken' }));
  await check('extras presence → 503 (db disabled)', () => req('POST', '/team/presence', { resourceType: 'api', resourceId: 1, teamId: 1 }, 503, { Authorization: 'Bearer faketoken' }));
  await check('import preview → 503 (db disabled)', () => req('POST', '/team/import/preview', { package: {}, teamId: 1, projectId: 1 }, 503, { Authorization: 'Bearer faketoken' }));
  // Resource dispatcher: team token + headers but DB disabled → falls through
  // to local routes which don't exist here → express default 404 (NOT 500).
  await check('business /apis with team token falls through when db off', async () => {
    const res = await fetch(`${base}/apis`, {
      headers: { Authorization: 'Bearer faketoken', 'X-Team-Id': '1', 'X-Project-Id': '1' },
    });
    if (res.status !== 404) throw new Error(`status ${res.status} (want 404 fallthrough)`);
    return '404 fallthrough correct';
  });

  console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failed} FAILED`);
  server.close();
  process.exit(failed === 0 ? 0 : 1);
});
