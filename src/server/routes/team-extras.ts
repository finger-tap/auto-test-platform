import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { teamAuthMiddleware } from './team-auth.js';
import { getTeamDb } from '../db-team/client.js';
import { getMembership, getTeamRow } from '../db-team/repo/org.js';
import { hasRole } from '../db-team/util.js';
import { writeSnapshot, contentHashOf } from '../db-team/repo/versions.js';
import { writeAudit, notifyResourceEvent, listAudit, listChannels, createChannel, updateChannel, deleteChannel, teamStats } from '../db-team/repo/audit.js';
import { nowSql, TeamApiError } from '../db-team/util.js';
import {
  presence, PRESENCE_TTL_SECONDS,
  tApis, tScenarios, tScenarioNodes, tScenarioEdges, tScenarioSets,
  tWebCases, tPcCases, tMobileCases,
  tCaseSetsWeb, tCaseSetsPc, tCaseSetsMobile,
  tEnvironments, tMocksApi, tMocksWeb, tMocksPc, tMocksMobile,
} from '../db-team/schema/index.js';
import type { AnyMySqlTable } from 'drizzle-orm/mysql-core';
import { getTableColumns } from 'drizzle-orm';

/**
 * /api/team/* extra endpoints: presence heartbeat, team stats, audit query,
 * notify-channel CRUD, and the .atpkg import engine (preview + commit with
 * ID remapping and reference rewriting).
 */

export const teamExtrasRoutes = Router();
teamExtrasRoutes.use(teamAuthMiddleware);

function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function parseId(v: string | undefined, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new TeamApiError(400, `无效的${label} ID`);
  return n;
}

// ── presence ───────────────────────────────────────────────────────────────

function presenceExpiry(): string {
  const d = new Date(Date.now() - PRESENCE_TTL_SECONDS * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

teamExtrasRoutes.post('/presence', ah(async (req, res) => {
  const { resourceType, resourceId, teamId } = (req.body ?? {}) as { resourceType?: string; resourceId?: number; teamId?: number };
  if (!resourceType || !Number.isInteger(resourceId) || !Number.isInteger(teamId)) {
    res.status(400).json({ code: 400, message: '参数不完整' });
    return;
  }
  const role = await getMembership(teamId, req.teamUser!.userId);
  if (!role) { res.status(404).json({ code: 404, message: '非团队成员' }); return; }
  const db = getTeamDb()!;
  const auth = req.teamUser!;
  await db.insert(presence).values({
    resourceType, resourceId, teamId,
    userId: auth.userId,
    nickname: auth.account,
    lastSeenAt: nowSql(),
  }).onDuplicateKeyUpdate({
    set: { lastSeenAt: nowSql(), nickname: auth.account },
  });
  res.json({ code: 200, message: 'ok', data: null });
}));

teamExtrasRoutes.get('/presence', ah(async (req, res) => {
  const { resourceType, resourceId, teamId } = req.query as Record<string, string>;
  if (!resourceType || !resourceId || !teamId) {
    res.json({ code: 200, message: 'ok', data: [] });
    return;
  }
  const db = getTeamDb()!;
  const rows = await db.select().from(presence).where(and(
    eq(presence.resourceType, resourceType),
    eq(presence.resourceId, Number(resourceId)),
    eq(presence.teamId, Number(teamId)),
    ne(presence.userId, req.teamUser!.userId),
    gt(presence.lastSeenAt, presenceExpiry()),
  ));
  res.json({ code: 200, message: 'ok', data: rows });
}));

// ── stats / audit / notify channels ────────────────────────────────────────

teamExtrasRoutes.get('/teams/:teamId/stats', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  await getMembership(teamId, req.teamUser!.userId);
  const projectId = Number(req.query.projectId) || null;
  const stats = await teamStats(teamId, projectId);
  res.json({ code: 200, message: 'ok', data: stats });
}));

teamExtrasRoutes.get('/teams/:teamId/audit', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  const role = await getMembership(teamId, req.teamUser!.userId);
  if (!role) throw new TeamApiError(404, '非团队成员');
  const rows = await listAudit(teamId, {
    projectId: Number(req.query.projectId) || null,
    resourceType: req.query.resourceType as string | undefined,
    limit: Number(req.query.limit) || 100,
  });
  res.json({ code: 200, message: 'ok', data: rows });
}));

teamExtrasRoutes.get('/teams/:teamId/channels', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  await getMembership(teamId, req.teamUser!.userId);
  const rows = await listChannels(teamId);
  res.json({ code: 200, message: 'ok', data: rows });
}));

teamExtrasRoutes.post('/teams/:teamId/channels', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  if (!hasRole(await getMembership(teamId, req.teamUser!.userId) ?? 'viewer', 'admin')) {
    throw new TeamApiError(403, '需要 admin 及以上角色');
  }
  const { name, type, webhook_url, secret, events, enabled } = (req.body ?? {}) as Record<string, never>;
  const ch = await createChannel(teamId, req.teamUser!.userId, {
    name: String(name ?? ''), type: String(type ?? 'feishu'), webhook_url: String(webhook_url ?? ''),
    secret: secret ? String(secret) : undefined,
    events: Array.isArray(events) ? (events as unknown as string[]) : undefined,
    enabled: enabled !== false,
  });
  res.status(201).json({ code: 201, message: '创建成功', data: ch });
}));

teamExtrasRoutes.put('/teams/:teamId/channels/:id', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  if (!hasRole(await getMembership(teamId, req.teamUser!.userId) ?? 'viewer', 'admin')) {
    throw new TeamApiError(403, '需要 admin 及以上角色');
  }
  const { name, webhook_url, secret, events, enabled } = (req.body ?? {}) as Record<string, unknown>;
  const ch = await updateChannel(teamId, parseId(req.params.id, '渠道'), {
    name: name === undefined ? undefined : String(name),
    webhook_url: webhook_url === undefined ? undefined : String(webhook_url),
    secret: secret === undefined ? undefined : String(secret),
    events: Array.isArray(events) ? (events as string[]) : undefined,
    enabled: enabled === undefined ? undefined : Boolean(enabled),
  });
  res.json({ code: 200, message: '更新成功', data: ch });
}));

teamExtrasRoutes.delete('/teams/:teamId/channels/:id', ah(async (req, res) => {
  const teamId = parseId(req.params.teamId, '团队');
  if (!hasRole(await getMembership(teamId, req.teamUser!.userId) ?? 'viewer', 'admin')) {
    throw new TeamApiError(403, '需要 admin 及以上角色');
  }
  await deleteChannel(teamId, parseId(req.params.id, '渠道'));
  res.json({ code: 200, message: '已删除', data: null });
}));

// ── .atpkg import engine ───────────────────────────────────────────────────

interface PkgItem { id: number; name: string; row: Record<string, unknown>; depOf?: Array<{ type: string; id: number }> }
interface Pkg {
  format: string;
  version: number;
  exportedAt: string;
  source: { mode: string; account: string };
  resources: Record<string, PkgItem[]>;
}

const IMPORT_ORDER = [
  'environments', 'apis', 'web_cases', 'pc_cases', 'mobile_cases',
  'scenarios', 'scenario_sets', 'case_sets_web', 'case_sets_pc', 'case_sets_mobile',
  'mocks_api', 'mocks_web', 'mocks_pc', 'mocks_mobile',
] as const;

const IMPORT_TABLES: Record<string, AnyMySqlTable> = {
  environments: tEnvironments,
  apis: tApis,
  web_cases: tWebCases,
  pc_cases: tPcCases,
  mobile_cases: tMobileCases,
  scenarios: tScenarios,
  scenario_sets: tScenarioSets,
  case_sets_web: tCaseSetsWeb,
  case_sets_pc: tCaseSetsPc,
  case_sets_mobile: tCaseSetsMobile,
  mocks_api: tMocksApi,
  mocks_web: tMocksWeb,
  mocks_pc: tMocksPc,
  mocks_mobile: tMocksMobile,
};

// local type name → package type name
const TYPE_TO_PKG: Record<string, string> = {
  environment: 'environments', api: 'apis', web_case: 'web_cases', pc_case: 'pc_cases',
  mobile_case: 'mobile_cases', scenario: 'scenarios', scenario_set: 'scenario_sets',
  case_set_web: 'case_sets_web', case_set_pc: 'case_sets_pc', case_set_mobile: 'case_sets_mobile',
  mock_api: 'mocks_api', mock_web: 'mocks_web', mock_pc: 'mocks_pc', mock_mobile: 'mocks_mobile',
};

/** Deep-rewrite {apiId / caseId} references inside scenario node config JSON. */
function remapConfigRefs(config: string | null, remap: Map<string, Map<number, number>>): string | null {
  if (!config) return config;
  try {
    const obj = JSON.parse(config);
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if ((k === 'apiId' || k === 'caseId') && typeof val === 'number') {
            const pkgType = k === 'apiId' ? 'apis' : null;
            const m = pkgType ? remap.get(pkgType) : remap.get('apis')!;
            // apiId always maps apis; caseId could be web/pc/mobile — try each
            let mapped = m?.get(val);
            if (mapped === undefined && k === 'caseId') {
              for (const t of ['web_cases', 'pc_cases', 'mobile_cases']) {
                const mm = remap.get(t)?.get(val);
                if (mm !== undefined) { mapped = mm; break; }
              }
            }
            out[k] = mapped ?? val;
          } else {
            out[k] = walk(val);
          }
        }
        return out;
      }
      return v;
    };
    return JSON.stringify(walk(obj));
  } catch {
    return config;
  }
}

function remapIdList(json: string | null | undefined, remap: Map<string, Map<number, number>>, pkgTypes: string[]): string {
  let ids: number[] = [];
  try { ids = json ? JSON.parse(json) : []; } catch { ids = []; }
  const out = ids.map((old) => {
    for (const t of pkgTypes) {
      const m = remap.get(t)?.get(old);
      if (m !== undefined) return m;
    }
    return old;
  });
  return JSON.stringify(out);
}

function writableFor(table: AnyMySqlTable, row: Record<string, unknown>): Record<string, unknown> {
  const cols = getTableColumns(table) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(cols)) {
    if (['id', 'team_id', 'project_id', 'owner_id', 'version', 'created_at', 'updated_at'].includes(name)) continue;
    if (name in row) out[name] = row[name];
  }
  return out;
}

teamExtrasRoutes.post('/import/preview', ah(async (req, res) => {
  const { package: pkg, teamId, projectId } = (req.body ?? {}) as { package?: Pkg; teamId?: number; projectId?: number };
  if (!pkg?.resources || !Number.isInteger(teamId) || !Number.isInteger(projectId)) {
    throw new TeamApiError(400, '导入包或团队/项目参数无效');
  }
  const role = await getMembership(teamId, req.teamUser!.userId);
  if (!role || !hasRole(role, 'editor')) throw new TeamApiError(403, '需要 editor 及以上角色');
  const db = getTeamDb()!;

  const items: Array<{
    type: string; localId: number; name: string; action: 'create' | 'conflict' | 'same';
    teamId?: number; teamName?: string; depOf?: Array<{ type: string; id: number; name?: string }>;
  }> = [];

  for (const pkgType of IMPORT_ORDER) {
    const list = pkg.resources[pkgType] ?? [];
    if (list.length === 0) continue;
    const table = IMPORT_TABLES[pkgType];
    const t = table as unknown as Record<string, never>;
    for (const it of list) {
      const existing = await db.select().from(table as never)
        .where(and(eq(t.team_id as never, teamId), eq(t.project_id as never, projectId), eq(t.name as never, it.name)))
        .limit(1);
      const cur = (existing as unknown as Record<string, unknown>[])[0];
      let action: 'create' | 'conflict' | 'same' = 'create';
      if (cur) {
        action = contentHashOf(cur) === contentHashOf(it.row) ? 'same' : 'conflict';
      }
      items.push({
        type: pkgType, localId: it.id, name: it.name, action,
        teamId: cur ? Number(cur.id) : undefined,
        depOf: (it.depOf ?? []).map((d) => ({ type: d.type, id: d.id })),
      });
    }
  }
  res.json({ code: 200, message: 'ok', data: { items } });
}));

teamExtrasRoutes.post('/import/commit', ah(async (req, res) => {
  const { package: pkg, teamId, projectId, strategies } = (req.body ?? {}) as {
    package?: Pkg; teamId?: number; projectId?: number;
    strategies?: Record<string, Record<string, string>>; // { [pkgType]: { [localId]: 'skip'|'overwrite'|'copy' } }
  };
  if (!pkg?.resources || !Number.isInteger(teamId) || !Number.isInteger(projectId)) {
    throw new TeamApiError(400, '导入包或团队/项目参数无效');
  }
  const role = await getMembership(teamId, req.teamUser!.userId);
  if (!role || !hasRole(role, 'editor')) throw new TeamApiError(403, '需要 editor 及以上角色');
  const db = getTeamDb()!;
  const now = nowSql();
  const account = req.teamUser!.account;
  const userId = req.teamUser!.userId;
  const remap = new Map<string, Map<number, number>>();
  const summary: Record<string, { created: number; overwritten: number; skipped: number; copied: number }> = {};

  for (const pkgType of IMPORT_ORDER) {
    summary[pkgType] = { created: 0, overwritten: 0, skipped: 0, copied: 0 };
    const list = pkg.resources[pkgType] ?? [];
    if (list.length === 0) continue;
    const table = IMPORT_TABLES[pkgType];
    const t = table as unknown as Record<string, never>;

    for (const it of list) {
      const strategy = strategies?.[pkgType]?.[String(it.id)] ?? 'copy';
      const existing = await db.select().from(table as never)
        .where(and(eq(t.team_id as never, teamId), eq(t.project_id as never, projectId), eq(t.name as never, it.name)))
        .limit(1);
      const cur = (existing as unknown as Record<string, unknown>[])[0];

      if (cur && strategy === 'skip') {
        summary[pkgType].skipped++;
        remap.set(pkgType, remap.get(pkgType) ?? new Map()).get(pkgType)!.set(it.id, Number(cur.id));
        continue;
      }
      const isSame = cur && contentHashOf(cur) === contentHashOf(it.row);
      if (cur && isSame && strategy !== 'copy') {
        summary[pkgType].skipped++;
        remap.set(pkgType, remap.get(pkgType) ?? new Map()).get(pkgType)!.set(it.id, Number(cur.id));
        continue;
      }

      // build writable values, rewriting cross references for composite types
      const row = { ...it.row };
      if (pkgType === 'scenario_sets') {
        row.scenario_ids = remapIdList(String(row.scenario_ids ?? '[]'), remap, ['scenarios']);
      } else if (pkgType.startsWith('case_sets_')) {
        row.test_case_ids = remapIdList(String(row.test_case_ids ?? '[]'), remap, ['web_cases', 'pc_cases', 'mobile_cases']);
      }
      const values: Record<string, unknown> = {
        ...writableFor(table, row),
        team_id: teamId, project_id: projectId,
        owner_id: userId, created_at: now, updated_at: now,
      };

      if (cur && (strategy === 'overwrite' || isSame)) {
        // snapshot the CURRENT team version before overwriting (never lose history)
        await writeSnapshot({
          resourceType: pkgType, resourceId: Number(cur.id), teamId, projectId,
          version: Number(cur.version ?? 1), row: cur, changedBy: userId,
          changeSummary: 'pre-import backup', origin: 'import-backup',
        });
        await db.update(table as never)
          .set({ ...values, version: Number(cur.version ?? 1) + 1 } as never)
          .where(eq(t.id as never, Number(cur.id)));
        const fresh = await db.select().from(table as never).where(eq(t.id as never, Number(cur.id))).limit(1);
        await writeSnapshot({
          resourceType: pkgType, resourceId: Number(cur.id), teamId, projectId,
          version: Number(cur.version ?? 1) + 1,
          row: (fresh as unknown as Record<string, unknown>[])[0]!,
          changedBy: userId, origin: `imported from local@${pkg.source?.account ?? 'unknown'}`,
        });
        remap.set(pkgType, remap.get(pkgType) ?? new Map()).get(pkgType)!.set(it.id, Number(cur.id));
        summary[pkgType].overwritten++;
        continue;
      }

      // create (strategy copy → rename if a same-name row exists)
      if (cur && strategy === 'copy') {
        values.name = `${it.name}（导入副本 ${now.slice(5, 16)}）`;
      }
      const inserted = await db.insert(table as never).values(values as never);
      const newId = Number((inserted as unknown as Array<{ insertId: number }>)[0].insertId);
      remap.set(pkgType, remap.get(pkgType) ?? new Map()).get(pkgType)!.set(it.id, newId);

      // composite children for scenarios
      if (pkgType === 'scenarios') {
        const nodes = (it.row.__nodes ?? []) as Array<Record<string, unknown>>;
        const edges = (it.row.__edges ?? []) as Array<Record<string, unknown>>;
        if (nodes.length > 0) {
          await db.insert(tScenarioNodes).values(nodes.map((nd) => ({
            scenario_id: newId,
            node_id: String(nd.node_id ?? ''),
            type: String(nd.type ?? 'start'),
            position_x: Number(nd.position_x ?? 0) || 0,
            position_y: Number(nd.position_y ?? 0) || 0,
            label: nd.label == null ? null : String(nd.label),
            config: remapConfigRefs(nd.config == null ? null : String(nd.config), remap),
            created_at: now, updated_at: now,
          })));
        }
        if (edges.length > 0) {
          await db.insert(tScenarioEdges).values(edges.map((ed) => ({
            scenario_id: newId,
            edge_id: String(ed.edge_id ?? ''),
            source_node_id: String(ed.source_node_id ?? ''),
            target_node_id: String(ed.target_node_id ?? ''),
            source_handle: ed.source_handle == null ? null : String(ed.source_handle),
            label: ed.label == null ? null : String(ed.label),
            created_at: now,
          })));
        }
      }

      const fresh = await db.select().from(table as never).where(eq(t.id as never, newId)).limit(1);
      const freshRow = (fresh as unknown as Record<string, unknown>[])[0]!;
      await writeSnapshot({
        resourceType: pkgType, resourceId: newId, teamId, projectId, version: 1,
        row: freshRow, changedBy: userId, origin: `imported from local@${pkg.source?.account ?? 'unknown'}`,
      });
      summary[pkgType].created++;
      if (cur && strategy === 'copy') summary[pkgType].copied++;
    }
  }

  await writeAudit({
    teamId, projectId, userId, account, action: 'import', resourceType: 'package',
    resourceId: null, resourceName: `atpkg@${pkg.exportedAt}`, detail: summary,
  });
  void notifyResourceEvent({ teamId, event: 'import', resourceType: 'package', resourceName: `${pkg.source?.account ?? ''} 的资源包`, account });

  res.json({ code: 200, message: '导入完成', data: { summary, remap: Object.fromEntries([...remap.entries()].map(([k, m]) => [k, Object.fromEntries(m)])) } });
}));

// Error translation
teamExtrasRoutes.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TeamApiError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  console.error('[team-extras] unexpected error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

void sql; void getTeamRow;
