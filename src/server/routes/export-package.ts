import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import db from '../db/index.js';

/**
 * LOCAL-instance export endpoints (standard local JWT auth):
 *
 *   GET  /api/export-package/preview   → resource tree for the import wizard
 *   POST /api/export-package/build     → full .atpkg package (JSON) with
 *                                        dependency closure computed from the
 *                                        user's selections
 *
 * The package is POSTed by the browser to the CENTER /api/team/import/preview
 * & /commit — see routes/team-extras.ts. Format: { format, version,
 * exportedAt, source, resources: { [type]: [{id, name, row, depOf}] } }.
 */

export const exportPackageRoutes = Router();
exportPackageRoutes.use(authMiddleware);

interface Row { [k: string]: unknown }

function all(sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function byId(sql: string, ...params: unknown[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

/** scenario node configs reference apis via {"apiId": n} — scan all nodes. */
function scenarioApiDeps(scenarioId: number): number[] {
  const nodes = all('SELECT config FROM scenario_nodes WHERE scenario_id = ?', scenarioId);
  const ids = new Set<number>();
  for (const n of nodes) {
    const cfg = String(n.config ?? '');
    if (!cfg) continue;
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v as Row)) {
            if ((k === 'apiId' || k === 'caseId') && typeof val === 'number') ids.add(val);
            else walk(val);
          }
        }
      };
      walk(JSON.parse(cfg));
    } catch { /* ignore malformed */ }
  }
  return [...ids];
}

function parseIds(json: string | null | undefined): number[] {
  if (!json) return [];
  try { return JSON.parse(json) as number[]; } catch { return []; }
}

const SECRET_KEY_RE = /password|passwd|secret|token|api[-_]?key|private[-_]?key/i;

function redactEnvRow(row: Row): Row {
  const out = { ...row };
  try {
    const vars = JSON.parse(String(row.variables ?? '[]')) as Array<{ name?: string; key?: string; value?: string }>;
    const redacted = vars.map((v) => ({
      ...v,
      value: SECRET_KEY_RE.test(String(v.name ?? v.key ?? '')) ? '' : v.value,
    }));
    out.variables = JSON.stringify(redacted);
  } catch { /* keep as-is */ }
  out.ssl_key = null;
  return out;
}

function stripRow(row: Row): Row {
  const { user_id: _u, ...rest } = row;
  void _u;
  return rest;
}

// ── preview ────────────────────────────────────────────────────────────────

exportPackageRoutes.get('/preview', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const pick = (table: string, extra = '') =>
    all(`SELECT id, name FROM ${table} WHERE user_id = ? ${extra} ORDER BY id`, userId)
      .map((r) => ({ id: Number(r.id), name: String(r.name ?? '') }));

  const scenarios = all('SELECT id, name FROM scenarios WHERE user_id = ? ORDER BY id', userId)
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      deps: scenarioApiDeps(Number(r.id)).length,
    }));

  const sets = all('SELECT id, name, scenario_ids FROM scenario_sets WHERE user_id = ? ORDER BY id', userId)
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      deps: parseIds(r.scenario_ids as string).length,
    }));

  const caseSet = (t: string) =>
    all(`SELECT id, name, test_case_ids FROM case_sets_${t} WHERE user_id = ? ORDER BY id`, userId)
      .map((r) => ({
        id: Number(r.id),
        name: String(r.name ?? ''),
        deps: parseIds(r.test_case_ids as string).length,
      }));

  res.json({
    code: 200,
    message: 'ok',
    data: {
      apis: pick('apis'),
      scenarios,
      scenario_sets: sets,
      web_cases: pick('web_test_cases'),
      pc_cases: pick('pc_test_cases'),
      mobile_cases: pick('mobile_test_cases'),
      case_sets_web: caseSet('web'),
      case_sets_pc: caseSet('pc'),
      case_sets_mobile: caseSet('mobile'),
      environments: pick('environments'),
      mocks_api: pick('mock_endpoints_api'),
      mocks_web: pick('mock_endpoints_web'),
      mocks_pc: pick('mock_endpoints_pc'),
      mocks_mobile: pick('mock_endpoints_mobile'),
    },
  });
});

// ── build ──────────────────────────────────────────────────────────────────

exportPackageRoutes.post('/build', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const selections = (req.body ?? {}) as Record<string, number[] | undefined>;
  const includeSecrets = Boolean((req.body as Record<string, unknown>)?.includeSecrets);

  const selected: Record<string, Set<number>> = {};
  for (const [k, v] of Object.entries(selections)) {
    if (k === 'includeSecrets') continue;
    if (Array.isArray(v)) selected[k] = new Set(v.map(Number));
  }
  const ensure = (t: string) => (selected[t] ??= new Set());

  // ── dependency closure ──
  // scenario_sets → scenarios; scenarios → apis; case_sets_* → cases
  for (const setId of [...(selected.scenario_sets ?? [])]) {
    const row = byId('SELECT scenario_ids FROM scenario_sets WHERE id = ? AND user_id = ?', setId, userId);
    for (const sid of parseIds(row?.scenario_ids as string)) ensure('scenarios').add(sid);
  }
  for (const scId of [...(selected.scenarios ?? [])]) {
    for (const apiId of scenarioApiDeps(scId)) {
      const api = byId('SELECT id FROM apis WHERE id = ? AND user_id = ?', apiId, userId);
      if (api) ensure('apis').add(apiId);
    }
  }
  for (const t of ['web', 'pc', 'mobile'] as const) {
    for (const setId of [...(selected[`case_sets_${t}`] ?? [])]) {
      const row = byId(`SELECT test_case_ids FROM case_sets_${t} WHERE id = ? AND user_id = ?`, setId, userId);
      for (const cid of parseIds(row?.test_case_ids as string)) ensure(`${t}_cases`).add(cid);
    }
  }

  const pkg = {
    format: 'autotest-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { mode: 'local', account: req.user!.account },
    resources: {} as Record<string, Array<{ id: number; name: string; row: Row; depOf?: Array<{ type: string; id: number }> }>>,
  };

  const depTracker = new Map<string, Map<number, Array<{ type: string; id: number }>>>();
  const markDep = (targetType: string, targetId: number, ownerType: string, ownerId: number) => {
    const m = depTracker.get(targetType) ?? new Map();
    const arr = m.get(targetId) ?? [];
    if (!arr.some((d) => d.id === ownerId)) arr.push({ type: ownerType, id: ownerId });
    m.set(targetId, arr);
    depTracker.set(targetType, m);
  };

  const load = (pkgType: string, sql: string, ids: number[]) => {
    if (ids.length === 0) return;
    const items = ids.map((id) => {
      const raw = byId(sql, id, userId);
      if (!raw) return null;
      let row = stripRow(raw);
      if (pkgType === 'environments' && !includeSecrets) row = redactEnvRow(row);
      if (pkgType === 'scenarios') {
        (row as Row).__nodes = all('SELECT * FROM scenario_nodes WHERE scenario_id = ?', id);
        (row as Row).__edges = all('SELECT * FROM scenario_edges WHERE scenario_id = ?', id);
      }
      return { id, name: String(raw.name ?? ''), row };
    }).filter(Boolean) as Array<{ id: number; name: string; row: Row }>;
    pkg.resources[pkgType] = items;
  };

  load('apis', 'SELECT * FROM apis WHERE id = ? AND user_id = ?', [...(selected.apis ?? [])]);
  load('scenarios', 'SELECT * FROM scenarios WHERE id = ? AND user_id = ?', [...(selected.scenarios ?? [])]);
  load('scenario_sets', 'SELECT * FROM scenario_sets WHERE id = ? AND user_id = ?', [...(selected.scenario_sets ?? [])]);
  load('web_cases', 'SELECT * FROM web_test_cases WHERE id = ? AND user_id = ?', [...(selected.web_cases ?? [])]);
  load('pc_cases', 'SELECT * FROM pc_test_cases WHERE id = ? AND user_id = ?', [...(selected.pc_cases ?? [])]);
  load('mobile_cases', 'SELECT * FROM mobile_test_cases WHERE id = ? AND user_id = ?', [...(selected.mobile_cases ?? [])]);
  load('case_sets_web', 'SELECT * FROM case_sets_web WHERE id = ? AND user_id = ?', [...(selected.case_sets_web ?? [])]);
  load('case_sets_pc', 'SELECT * FROM case_sets_pc WHERE id = ? AND user_id = ?', [...(selected.case_sets_pc ?? [])]);
  load('case_sets_mobile', 'SELECT * FROM case_sets_mobile WHERE id = ? AND user_id = ?', [...(selected.case_sets_mobile ?? [])]);
  load('environments', 'SELECT * FROM environments WHERE id = ? AND user_id = ?', [...(selected.environments ?? [])]);
  load('mocks_api', 'SELECT * FROM mock_endpoints_api WHERE id = ? AND user_id = ?', [...(selected.mocks_api ?? [])]);
  load('mocks_web', 'SELECT * FROM mock_endpoints_web WHERE id = ? AND user_id = ?', [...(selected.mocks_web ?? [])]);
  load('mocks_pc', 'SELECT * FROM mock_endpoints_pc WHERE id = ? AND user_id = ?', [...(selected.mocks_pc ?? [])]);
  load('mocks_mobile', 'SELECT * FROM mock_endpoints_mobile WHERE id = ? AND user_id = ?', [...(selected.mocks_mobile ?? [])]);

  // annotate depOf (who pulled each resource in)
  for (const sid of selected.scenario_sets ?? []) {
    const row = byId('SELECT scenario_ids FROM scenario_sets WHERE id = ? AND user_id = ?', sid, userId);
    for (const s of parseIds(row?.scenario_ids as string)) markDep('scenarios', s, 'scenario_sets', sid);
  }
  for (const scId of selected.scenarios ?? []) {
    for (const apiId of scenarioApiDeps(scId)) markDep('apis', apiId, 'scenarios', scId);
  }
  for (const t of ['web', 'pc', 'mobile'] as const) {
    for (const setId of selected[`case_sets_${t}`] ?? []) {
      const row = byId(`SELECT test_case_ids FROM case_sets_${t} WHERE id = ? AND user_id = ?`, setId, userId);
      for (const cid of parseIds(row?.test_case_ids as string)) markDep(`${t}_cases`, cid, `case_sets_${t}`, setId);
    }
  }
  const depTypeToPkg: Record<string, string> = { scenarios: 'scenarios', apis: 'apis', web_cases: 'web_cases', pc_cases: 'pc_cases', mobile_cases: 'mobile_cases' };
  for (const [depType, ids] of depTracker) {
    const pkgType = depTypeToPkg[depType];
    if (!pkgType) continue;
    for (const it of pkg.resources[pkgType] ?? []) {
      const deps = ids.get(it.id);
      if (deps && !selected[pkgType]?.has(it.id)) it.depOf = deps;
    }
  }

  res.json({ code: 200, message: 'ok', data: pkg });
});
