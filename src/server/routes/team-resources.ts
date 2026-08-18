import type { Request, Response, NextFunction } from 'express';
import { and, asc, desc, eq, like, sql, getTableColumns, type SQL } from 'drizzle-orm';
import type { AnyMySqlTable } from 'drizzle-orm/mysql-core';
import { createHash, randomUUID } from 'node:crypto';
import { verifyTeamToken } from '../auth/team-jwt.js';
import { isTeamDbEnabled, isTeamReady, getTeamDb } from '../db-team/client.js';
import { getMembership } from '../db-team/repo/org.js';
import { hasRole } from '../db-team/util.js';
import { writeSnapshot, listVersions, getSnapshot, contentHashOf } from '../db-team/repo/versions.js';
import { writeAudit, notifyResourceEvent } from '../db-team/repo/audit.js';
import { nowSql, TeamApiError } from '../db-team/util.js';
import {
  tScenarios, tScenarioNodes, tScenarioEdges,
  tWebCases, tPcCases, tMobileCases,
  tEnvironments, tDevices, tTags,
} from '../db-team/schema/index.js';
import {
  tApis, tScenarioSets, tCaseSetsWeb, tCaseSetsPc, tCaseSetsMobile,
  tMocksApi, tMocksWeb, tMocksPc, tMocksMobile,
  tScheduleSetsApi, tScheduleSetsWeb, tScheduleSetsPc, tScheduleSetsMobile,
} from '../db-team/schema/index.js';

/**
 * Team resource dispatcher — THE bridge that lets the existing frontend pages
 * work against the center server unchanged.
 *
 * Handles a request when ALL of:
 *   1. Authorization carries a valid TEAM token (center JWT, not local JWT)
 *   2. the path matches a registered business resource (apis, web-cases, ...)
 *   3. headers X-Team-Id / X-Project-Id are present (apiFetch sends them in
 *      team workspace mode)
 * Everything else (local tokens, /auth, /team/*, previews...) falls through
 * to the local routes untouched.
 *
 * Optimistic lock: an in-process LRU remembers the row version served at the
 * last GET /:id per (user, type, id). A PUT whose remembered version no
 * longer matches the stored row → 409 + current row (someone else saved in
 * between). Clients may also send `version` in the PUT body.
 */

interface ResourceDef {
  path: string;
  table: AnyMySqlTable;
  type: string;
  list: 'paged' | 'array';
  likeFilters?: string[];
  eqFilters?: string[];
  parentFilter?: { param: string; column: string };
  scenarioChildren?: boolean;
}

const RESOURCES: ResourceDef[] = [
  { path: 'apis', table: tApis, type: 'api', list: 'paged', likeFilters: ['name', 'description'], eqFilters: ['status'] },
  { path: 'scenarios', table: tScenarios, type: 'scenario', list: 'paged', likeFilters: ['name', 'description'], eqFilters: ['status'], scenarioChildren: true },
  { path: 'scenario-sets', table: tScenarioSets, type: 'scenario_set', list: 'paged', likeFilters: ['name', 'description'] },
  { path: 'web-cases', table: tWebCases, type: 'web_case', list: 'paged', likeFilters: ['name', 'description'], eqFilters: ['status', 'browser'] },
  { path: 'pc-cases', table: tPcCases, type: 'pc_case', list: 'paged', likeFilters: ['name', 'description'], eqFilters: ['status', 'platform'] },
  { path: 'mobile-tests', table: tMobileCases, type: 'mobile_case', list: 'paged', likeFilters: ['name', 'description'], eqFilters: ['status', 'platform'] },
  { path: 'case-sets-web', table: tCaseSetsWeb, type: 'case_set_web', list: 'paged', likeFilters: ['name', 'description'] },
  { path: 'case-sets-pc', table: tCaseSetsPc, type: 'case_set_pc', list: 'paged', likeFilters: ['name', 'description'] },
  { path: 'case-sets-mobile', table: tCaseSetsMobile, type: 'case_set_mobile', list: 'paged', likeFilters: ['name', 'description'] },
  { path: 'environments', table: tEnvironments, type: 'environment', list: 'array' },
  { path: 'devices', table: tDevices, type: 'device', list: 'array', eqFilters: ['test_type', 'status'] },
  { path: 'mocks-api', table: tMocksApi, type: 'mock_api', list: 'paged', likeFilters: ['name', 'path_pattern', 'description'] },
  { path: 'mocks-web', table: tMocksWeb, type: 'mock_web', list: 'paged', likeFilters: ['name', 'path_pattern', 'description'] },
  { path: 'mocks-pc', table: tMocksPc, type: 'mock_pc', list: 'paged', likeFilters: ['name', 'path_pattern', 'description'] },
  { path: 'mocks-mobile', table: tMocksMobile, type: 'mock_mobile', list: 'paged', likeFilters: ['name', 'path_pattern', 'description'] },
  { path: 'schedule-sets-api', table: tScheduleSetsApi, type: 'schedule_api', list: 'array', parentFilter: { param: 'scenarioSetId', column: 'scenario_set_id' } },
  { path: 'schedule-sets-web', table: tScheduleSetsWeb, type: 'schedule_web', list: 'array', parentFilter: { param: 'caseSetId', column: 'case_set_id' } },
  { path: 'schedule-sets-pc', table: tScheduleSetsPc, type: 'schedule_pc', list: 'array', parentFilter: { param: 'caseSetId', column: 'case_set_id' } },
  { path: 'schedule-sets-mobile', table: tScheduleSetsMobile, type: 'schedule_mobile', list: 'array', parentFilter: { param: 'caseSetId', column: 'case_set_id' } },
];

const BY_PATH = new Map(RESOURCES.map((r) => [r.path, r]));

const META_COLS = new Set(['id', 'team_id', 'project_id', 'owner_id', 'version', 'created_at', 'updated_at']);

type Cols = Record<string, { name: string; dataType: string }>;

function colsOf(table: AnyMySqlTable): Cols {
  return getTableColumns(table) as unknown as Cols;
}

/** property name → column meta for a table (props are snake_case = names). */
function pickWritable(body: Record<string, unknown>, table: AnyMySqlTable): Record<string, unknown> {
  const cols = colsOf(table);
  const out: Record<string, unknown> = {};
  for (const [name, col] of Object.entries(cols)) {
    if (META_COLS.has(name)) continue;
    if (name in body && body[name] !== undefined) {
      let v = body[name];
      if (col.dataType === 'number' && (typeof v === 'string' || typeof v === 'number')) {
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      }
      out[name] = v;
    }
  }
  return out;
}

// ── optimistic-lock LRU ───────────────────────────────────────────────────

const seenVersions = new Map<string, number>();
function markSeen(userId: number, type: string, id: number, version: number) {
  seenVersions.set(`${userId}:${type}:${id}`, version);
  if (seenVersions.size > 8000) {
    const drop = Math.floor(seenVersions.size / 2);
    let i = 0;
    for (const k of seenVersions.keys()) {
      seenVersions.delete(k);
      if (++i >= drop) break;
    }
  }
}

// ── context ────────────────────────────────────────────────────────────────

interface Ctx {
  def: ResourceDef;
  teamId: number;
  projectId: number;
  userId: number;
  account: string;
  role: string;
  table: AnyMySqlTable;
}

async function teamCtxFrom(req: Request): Promise<{ teamId: number; projectId: number; role: string } | null> {
  const teamId = Number(req.headers['x-team-id']);
  const projectId = Number(req.headers['x-project-id']);
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const role = await getMembership(teamId, req.teamUser!.userId);
  if (!role) return null;
  return { teamId, projectId, role };
}

function scopeWhere(ctx: Ctx): SQL[] {
  const t = ctx.table as unknown as Record<string, never>;
  return [eq(t.team_id as never, ctx.teamId) as SQL, eq(t.project_id as never, ctx.projectId) as SQL];
}

async function rowById(ctx: Ctx, id: number): Promise<Record<string, unknown> | undefined> {
  const t = ctx.table as unknown as Record<string, never>;
  const rows = await getTeamDb()!.select().from(ctx.table as never)
    .where(and(...scopeWhere(ctx), eq(t.id as never, id) as SQL))
    .limit(1);
  return (rows as unknown as Record<string, unknown>[])[0];
}

function nameOf(row: Record<string, unknown> | undefined): string {
  return String(row?.name ?? row?.cron_expr ?? row?.path_pattern ?? '');
}

// ── dispatcher ─────────────────────────────────────────────────────────────

export async function teamResourceDispatcher(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isTeamDbEnabled() || !isTeamReady()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const payload = verifyTeamToken(header.slice(7));
  if (!payload) return next(); // local JWT or garbage → local routes
  req.teamUser = { userId: payload.userId, account: payload.account };

  const segments = req.path.replace(/^\//, '').split('/').filter(Boolean);
  const head = segments[0] ?? '';
  const def = BY_PATH.get(head);
  const teamHdr = Number(req.headers['x-team-id']);

  // Special team-mode-only endpoints that are NOT table resources.
  if (!def) {
    if (!Number.isInteger(teamHdr) || teamHdr <= 0) return next();
    if (head === 'tags') return await handleTags(req, res, teamHdr);
    if (head === 'dashboard' && Number.isInteger(Number(req.headers['x-project-id']))) {
      return await handleDashboard(req, res, Number(req.headers['x-project-id']));
    }
    if (/^batch-reports/.test(head)) {
      // batch reports live on the executing instance; team mode has none yet.
      res.json({ code: 200, message: 'ok', data: { items: [], total: 0, page: 1, pageSize: 10 } });
      return;
    }
    return next();
  }

  const ctxInfo = await teamCtxFrom(req);
  if (!ctxInfo) {
    if (!Number.isInteger(teamHdr) || teamHdr <= 0) {
      res.status(400).json({ code: 400, message: '缺少团队上下文（请在顶栏选择团队）' });
      return;
    }
    res.status(404).json({ code: 404, message: '团队不存在或你不是该团队成员' });
    return;
  }
  const ctx: Ctx = {
    def, ...ctxInfo,
    userId: payload.userId, account: payload.account,
    table: def.table,
  };

  const idStr = segments[1];
  const sub = segments[2];

  try {
    if (!idStr) {
      // collection-level special endpoints that shadow /:id
      if (head === 'environments' && segments[1] === undefined && req.method === 'GET') {
        return await handleList(req, res, ctx);
      }
      if (req.method === 'GET') {
        if (head === 'environments' && req.path.endsWith('/default')) {
          return await handleEnvDefault(req, res, ctx);
        }
        if (head === 'devices' && req.path.endsWith('/merged')) {
          return await handleDevicesMerged(req, res, ctx);
        }
        return await handleList(req, res, ctx);
      }
      if (req.method === 'POST') {
        if (head === 'environments' && req.path.endsWith('/test-db')) {
          res.status(501).json({ code: 501, message: '团队模式下连接测试暂未开放，请在个人空间测试后导入' });
          return;
        }
        return await handleCreate(req, res, ctx);
      }
      res.status(405).json({ code: 405, message: 'Method not allowed' });
      return;
    }

    // /:id sub-resource endpoints
    if (sub && /^(execute|preview|push|refresh|stop|export)/.test(sub)) {
      res.status(501).json({ code: 501, message: '该操作在团队模式下暂未开放（中心执行器接入后启用）' });
      return;
    }
    if (sub === 'logs' || sub === 'executions') {
      if (req.method === 'GET') {
        res.json({ code: 200, message: 'ok', data: [] });
        return;
      }
    }
    if (sub === 'agent-info' && req.method === 'GET') {
      const row = await rowById(ctx, Number(idStr));
      if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }
      res.json({ code: 200, message: 'ok', data: row });
      return;
    }
    if (sub === 'versions' && req.method === 'GET') {
      const rows = await listVersions(def.type, Number(idStr), ctx.teamId);
      res.json({ code: 200, message: 'ok', data: rows });
      return;
    }
    if (sub === 'rollback' && req.method === 'POST') {
      return await handleRollback(req, res, ctx, Number(idStr));
    }
    if (sub === 'flow' && req.method === 'PUT' && def.scenarioChildren) {
      return await handleFlowSave(req, res, ctx, Number(idStr));
    }
    // id-level path that isn't a number → treat as unsupported sub-endpoint
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ code: 400, message: '无效 ID' });
      return;
    }

    if (req.method === 'GET') return await handleDetail(req, res, ctx, id);
    if (req.method === 'PUT') return await handleUpdate(req, res, ctx, id);
    if (req.method === 'DELETE') return await handleDelete(req, res, ctx, id);
    res.status(405).json({ code: 405, message: 'Method not allowed' });
    return;
  } catch (err) {
    if (err instanceof TeamApiError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    console.error('[team-resources] error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
}

// ── handlers ───────────────────────────────────────────────────────────────

async function handleList(req: Request, res: Response, ctx: Ctx): Promise<void> {
  const db = getTeamDb()!;
  const t = ctx.table as unknown as Record<string, never>;
  const conds = scopeWhere(ctx);
  const q = req.query as Record<string, string | undefined>;

  for (const colName of ctx.def.likeFilters ?? []) {
    const v = q[colName === 'path_pattern' ? 'path' : colName] ?? q[colName];
    if (v) conds.push(like(t[colName] as never, `%${v}%`) as SQL);
  }
  for (const colName of ctx.def.eqFilters ?? []) {
    const v = q[colName];
    if (v) conds.push(eq(t[colName] as never, v) as SQL);
  }
  if (q.tag && 'tags' in colsOf(ctx.table)) conds.push(like(t.tags as never, `%${q.tag}%`) as SQL);
  if (q.tags && 'tags' in colsOf(ctx.table)) conds.push(like(t.tags as never, `%${q.tags}%`) as SQL);
  if (q.dateFrom) conds.push(sql`${t.updated_at as never} >= ${q.dateFrom}` as SQL);
  if (q.dateTo) conds.push(sql`${t.updated_at as never} <= ${q.dateTo} 23:59:59` as SQL);
  if (q.keyword) conds.push(like(t.name as never, `%${q.keyword}%`) as SQL);
  if (ctx.def.parentFilter) {
    const pv = q[ctx.def.parentFilter.param] ?? q[ctx.def.parentFilter.column];
    if (pv !== undefined && pv !== '') {
      conds.push(eq(t[ctx.def.parentFilter.column] as never, Number(pv)) as SQL);
    }
  }

  const where = and(...conds);
  const sortField = ['updated_at', 'created_at', 'name'].includes(q.sort ?? '') ? q.sort! : 'updated_at';
  const sortCol = t[sortField] as never;
  const orderBy = String(q.order).toUpperCase() === 'ASC' ? asc(sortCol) : desc(sortCol);

  if (ctx.def.list === 'array') {
    const rows = await db.select().from(ctx.table as never).where(where).orderBy(orderBy as never);
    const out = (rows as unknown as Record<string, unknown>[]).map((r) =>
      ctx.def.path === 'devices' ? { ...r, busy: false } : r,
    );
    res.json({ code: 200, message: 'ok', data: out });
    return;
  }

  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 10));
  const cnt = await db.select({ n: sql<number>`count(*)` }).from(ctx.table as never).where(where);
  const total = Number((cnt as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  const items = await db.select().from(ctx.table as never).where(where).orderBy(orderBy as never)
    .limit(pageSize).offset((page - 1) * pageSize);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
}

async function handleEnvDefault(req: Request, res: Response, ctx: Ctx): Promise<void> {
  const db = getTeamDb()!;
  const rows = await db.select().from(ctx.table as never).where(and(...scopeWhere(ctx)))
    .orderBy(desc(tEnvironments.is_default), asc(tEnvironments.sort_order)).limit(1);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (!row) {
    res.json({ code: 200, message: 'ok', data: null });
    return;
  }
  res.json({ code: 200, message: 'ok', data: row });
}

async function handleDevicesMerged(req: Request, res: Response, ctx: Ctx): Promise<void> {
  // Team-mode /devices/merged: only agent-backed remote devices qualify
  // (mirrors the local web/pc rule). Local USB devices belong to the local
  // instance and are not visible on the center.
  const q = req.query as Record<string, string | undefined>;
  const testType = q.test_type ?? '';
  if (!['web', 'pc', 'mobile'].includes(testType)) {
    res.status(400).json({ code: 400, message: `Invalid test_type for /merged: ${testType || '∅'}` });
    return;
  }
  const db = getTeamDb()!;
  const rows = await db.select().from(tDevices)
    .where(and(eq(tDevices.team_id, ctx.teamId), eq(tDevices.project_id, ctx.projectId), eq(tDevices.test_type, testType)));
  const items = rows
    .filter((d) => d.status === 'online' && !!d.agent_endpoint && !!d.agent_token)
    .map((d) => ({ ...d, busy: false, kind: 'remote', source: 'remote' }));
  res.json({ code: 200, message: 'ok', data: { items } });
}

async function handleCreate(req: Request, res: Response, ctx: Ctx): Promise<void> {
  if (!hasRole(ctx.role, 'editor')) {
    res.status(403).json({ code: 403, message: '需要 editor 及以上角色' });
    return;
  }
  const db = getTeamDb()!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!String(body.name ?? '').trim() && 'name' in colsOf(ctx.table)) {
    res.status(400).json({ code: 400, message: '名称不能为空' });
    return;
  }
  const now = nowSql();
  const values: Record<string, unknown> = {
    ...pickWritable(body, ctx.table),
    team_id: ctx.teamId,
    project_id: ctx.projectId,
    owner_id: ctx.userId,
    created_at: now,
    updated_at: now,
  };
  const cols = colsOf(ctx.table);
  if ('created_by' in cols && !values.created_by) values.created_by = ctx.account;
  if ('updated_by' in cols) values.updated_by = ctx.account;
  if (ctx.def.path === 'devices') {
    if (!values.status) values.status = 'offline';
    if (!values.agent_token) values.agent_token = randomUUID();
  }

  const inserted = await db.insert(ctx.table as never).values(values as never);
  const id = Number((inserted as unknown as Array<{ insertId: number }>)[0].insertId);
  const row = await rowById(ctx, id);

  await writeSnapshot({ resourceType: ctx.def.type, resourceId: id, teamId: ctx.teamId, projectId: ctx.projectId, version: 1, row: row!, changedBy: ctx.userId, origin: 'created' });
  await writeAudit({ teamId: ctx.teamId, projectId: ctx.projectId, userId: ctx.userId, account: ctx.account, action: 'create', resourceType: ctx.def.type, resourceId: id, resourceName: nameOf(row) });
  void notifyResourceEvent({ teamId: ctx.teamId, event: 'resource.create', resourceType: ctx.def.type, resourceName: nameOf(row), account: ctx.account });

  res.status(201).json({ code: 201, message: '创建成功', data: row });
}

async function handleDetail(req: Request, res: Response, ctx: Ctx, id: number): Promise<void> {
  const row = await rowById(ctx, id);
  if (!row) {
    res.status(404).json({ code: 404, message: '不存在' });
    return;
  }
  markSeen(ctx.userId, ctx.def.type, id, Number(row.version ?? 1));

  if (ctx.def.scenarioChildren) {
    const db = getTeamDb()!;
    const nodes = await db.select().from(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
    const edges = await db.select().from(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));
    res.json({ code: 200, message: 'ok', data: { scenario: row, nodes, edges } });
    return;
  }
  res.json({ code: 200, message: 'ok', data: row });
}

async function handleUpdate(req: Request, res: Response, ctx: Ctx, id: number): Promise<void> {
  if (!hasRole(ctx.role, 'editor')) {
    res.status(403).json({ code: 403, message: '需要 editor 及以上角色' });
    return;
  }
  const db = getTeamDb()!;
  const t = ctx.table as unknown as Record<string, never>;
  const current = await rowById(ctx, id);
  if (!current) {
    res.status(404).json({ code: 404, message: '不存在' });
    return;
  }

  const seen = seenVersions.get(`${ctx.userId}:${ctx.def.type}:${id}`);
  const bodyVersion = Number((req.body as Record<string, unknown>)?.version);
  const currentVersion = Number(current.version ?? 1);
  if (
    (Number.isInteger(seen) && seen !== currentVersion) ||
    (Number.isInteger(bodyVersion) && bodyVersion > 0 && bodyVersion !== currentVersion)
  ) {
    res.status(409).json({
      code: 409,
      message: '该资源已被其他人修改，请刷新页面加载最新版本后再保存',
      data: { conflict: true, current, currentVersion },
    });
    return;
  }

  const writable = pickWritable((req.body ?? {}) as Record<string, unknown>, ctx.table);
  if ('updated_by' in colsOf(ctx.table)) writable.updated_by = ctx.account;
  writable.updated_at = nowSql();

  await db.update(ctx.table as never)
    .set({ ...writable, version: currentVersion + 1 } as never)
    .where(and(...scopeWhere(ctx), eq(t.id as never, id) as SQL));

  const row = await rowById(ctx, id);
  markSeen(ctx.userId, ctx.def.type, id, currentVersion + 1);

  if (contentHashOf(row!) !== contentHashOf(current)) {
    await writeSnapshot({ resourceType: ctx.def.type, resourceId: id, teamId: ctx.teamId, projectId: ctx.projectId, version: currentVersion + 1, row: row!, changedBy: ctx.userId });
  }
  await writeAudit({ teamId: ctx.teamId, projectId: ctx.projectId, userId: ctx.userId, account: ctx.account, action: 'update', resourceType: ctx.def.type, resourceId: id, resourceName: nameOf(row) });
  void notifyResourceEvent({ teamId: ctx.teamId, event: 'resource.update', resourceType: ctx.def.type, resourceName: nameOf(row), account: ctx.account });

  res.json({ code: 200, message: '更新成功', data: row });
}

async function handleDelete(req: Request, res: Response, ctx: Ctx, id: number): Promise<void> {
  if (!hasRole(ctx.role, 'editor')) {
    res.status(403).json({ code: 403, message: '需要 editor 及以上角色' });
    return;
  }
  const db = getTeamDb()!;
  const t = ctx.table as unknown as Record<string, never>;
  const current = await rowById(ctx, id);
  if (!current) {
    res.status(404).json({ code: 404, message: '不存在' });
    return;
  }
  await db.delete(ctx.table as never).where(and(...scopeWhere(ctx), eq(t.id as never, id) as SQL));

  if (ctx.def.scenarioChildren) {
    await db.delete(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
    await db.delete(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));
  }

  await writeAudit({ teamId: ctx.teamId, projectId: ctx.projectId, userId: ctx.userId, account: ctx.account, action: 'delete', resourceType: ctx.def.type, resourceId: id, resourceName: nameOf(current) });
  void notifyResourceEvent({ teamId: ctx.teamId, event: 'resource.delete', resourceType: ctx.def.type, resourceName: nameOf(current), account: ctx.account });

  seenVersions.delete(`${ctx.userId}:${ctx.def.type}:${id}`);
  res.json({ code: 200, message: '已删除', data: null });
}

async function handleFlowSave(req: Request, res: Response, ctx: Ctx, id: number): Promise<void> {
  if (!hasRole(ctx.role, 'editor')) {
    res.status(403).json({ code: 403, message: '需要 editor 及以上角色' });
    return;
  }
  const scenario = await rowById(ctx, id);
  if (!scenario) {
    res.status(404).json({ code: 404, message: '场景不存在' });
    return;
  }
  const { nodes, edges } = (req.body ?? {}) as { nodes?: unknown[]; edges?: unknown[] };
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    res.status(400).json({ code: 400, message: 'nodes and edges must be arrays' });
    return;
  }
  const db = getTeamDb()!;
  const t = ctx.table as unknown as Record<string, never>;
  const now = nowSql();
  await db.delete(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
  await db.delete(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));
  if (nodes.length > 0) {
    await db.insert(tScenarioNodes).values(nodes.map((n) => {
      const nd = n as Record<string, unknown>;
      return {
        scenario_id: id,
        node_id: String(nd.node_id ?? nd.id ?? ''),
        type: String(nd.type ?? 'start'),
        position_x: Number(nd.position_x ?? 0) || 0,
        position_y: Number(nd.position_y ?? 0) || 0,
        label: nd.label == null ? null : String(nd.label),
        config: nd.config == null ? null : (typeof nd.config === 'string' ? nd.config : JSON.stringify(nd.config)),
        created_at: now,
        updated_at: now,
      };
    }));
  }
  if (edges.length > 0) {
    await db.insert(tScenarioEdges).values(edges.map((e) => {
      const ed = e as Record<string, unknown>;
      return {
        scenario_id: id,
        edge_id: String(ed.edge_id ?? ed.id ?? ''),
        source_node_id: String(ed.source_node_id ?? ed.source ?? ''),
        target_node_id: String(ed.target_node_id ?? ed.target ?? ''),
        source_handle: ed.source_handle == null ? null : String(ed.source_handle),
        label: ed.label == null ? null : String(ed.label),
        created_at: now,
      };
    }));
  }
  const nextVersion = Number(scenario.version ?? 1) + 1;
  await db.update(ctx.table as never)
    .set({ version: nextVersion, updated_at: now } as never)
    .where(eq(t.id as never, id));
  const fresh = await rowById(ctx, id);
  const nodesAfter = await db.select().from(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
  const edgesAfter = await db.select().from(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));
  await writeSnapshot({
    resourceType: ctx.def.type, resourceId: id, teamId: ctx.teamId, projectId: ctx.projectId,
    version: nextVersion, row: { scenario: fresh, nodes: nodesAfter, edges: edgesAfter },
    changedBy: ctx.userId, changeSummary: 'flow update',
  });
  markSeen(ctx.userId, ctx.def.type, id, nextVersion);
  res.json({ code: 200, message: 'Flow saved' });
}

async function handleRollback(req: Request, res: Response, ctx: Ctx, id: number): Promise<void> {
  if (!hasRole(ctx.role, 'editor')) {
    res.status(403).json({ code: 403, message: '需要 editor 及以上角色' });
    return;
  }
  const targetVersion = Number((req.body ?? {}).version);
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    res.status(400).json({ code: 400, message: '无效版本号' });
    return;
  }
  const current = await rowById(ctx, id);
  if (!current) {
    res.status(404).json({ code: 404, message: '不存在' });
    return;
  }
  const snap = await getSnapshot(ctx.def.type, id, ctx.teamId, targetVersion);
  if (!snap) {
    res.status(404).json({ code: 404, message: '版本不存在' });
    return;
  }
  // scenario snapshots are composite {scenario, nodes, edges}
  const snapRow = (snap.scenario as Record<string, unknown> | undefined) ?? snap;
  const db = getTeamDb()!;
  const t = ctx.table as unknown as Record<string, never>;
  const writable = pickWritable(snapRow, ctx.table);
  if ('updated_by' in colsOf(ctx.table)) writable.updated_by = ctx.account;
  const nextVersion = Number(current.version ?? 1) + 1;
  await db.update(ctx.table as never)
    .set({ ...writable, version: nextVersion, updated_at: nowSql() } as never)
    .where(and(...scopeWhere(ctx), eq(t.id as never, id) as SQL));
  if (ctx.def.scenarioChildren && Array.isArray(snap.nodes) && Array.isArray(snap.edges)) {
    await db.delete(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
    await db.delete(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));
    const now = nowSql();
    if (snap.nodes.length > 0) {
      await db.insert(tScenarioNodes).values((snap.nodes as Array<Record<string, unknown>>).map((nd) => ({
        scenario_id: id,
        node_id: String(nd.node_id ?? ''),
        type: String(nd.type ?? 'start'),
        position_x: Number(nd.position_x ?? 0) || 0,
        position_y: Number(nd.position_y ?? 0) || 0,
        label: nd.label == null ? null : String(nd.label),
        config: nd.config == null ? null : String(nd.config),
        created_at: now,
        updated_at: now,
      })));
    }
    if (snap.edges.length > 0) {
      await db.insert(tScenarioEdges).values((snap.edges as Array<Record<string, unknown>>).map((ed) => ({
        scenario_id: id,
        edge_id: String(ed.edge_id ?? ''),
        source_node_id: String(ed.source_node_id ?? ''),
        target_node_id: String(ed.target_node_id ?? ''),
        source_handle: ed.source_handle == null ? null : String(ed.source_handle),
        label: ed.label == null ? null : String(ed.label),
        created_at: now,
      })));
    }
  }
  const fresh = await rowById(ctx, id);
  await writeSnapshot({ resourceType: ctx.def.type, resourceId: id, teamId: ctx.teamId, projectId: ctx.projectId, version: nextVersion, row: fresh!, changedBy: ctx.userId, changeSummary: `rollback to v${targetVersion}`, origin: 'rollback' });
  markSeen(ctx.userId, ctx.def.type, id, nextVersion);
  res.json({ code: 200, message: `已回滚到 v${targetVersion}`, data: fresh });
}

// ── team tags (shape-compatible with local /api/tags) ─────────────────────

async function handleTags(req: Request, res: Response, teamId: number): Promise<void> {
  const db = getTeamDb()!;
  if (req.method === 'GET') {
    const rows = await db.select().from(tTags).where(eq(tTags.team_id, teamId));
    const result = rows.map((r) => ({
      name: r.name,
      color: r.color || '',
      apis: 0, scenarios: 0, scenario_sets: 0, // counts are optional decoration
    }));
    res.json({ code: 200, message: 'ok', data: result });
    return;
  }
  if (req.method === 'POST') {
    const { name, color } = (req.body ?? {}) as { name?: string; color?: string };
    if (!name?.trim()) {
      res.status(400).json({ code: 400, message: '标签名不能为空' });
      return;
    }
    const existing = await db.select().from(tTags).where(and(eq(tTags.team_id, teamId), eq(tTags.name, name.trim()))).limit(1);
    if (existing[0]) {
      res.json({ code: 200, message: 'Tag already exists', data: { name: existing[0].name, color: existing[0].color, exists: true } });
      return;
    }
    await db.insert(tTags).values({ team_id: teamId, name: name.trim(), color: color || '', created_at: nowSql() });
    res.json({ code: 200, message: 'Tag created', data: { name: name.trim(), color: color || '', exists: false } });
    return;
  }
  if (req.method === 'PUT') {
    // rename / recolor: /tags/:name with { name?, color? }
    const segs = req.path.replace(/^\//, '').split('/').filter(Boolean);
    const oldName = decodeURIComponent(segs[1] ?? '');
    const { name, color } = (req.body ?? {}) as { name?: string; color?: string };
    if (name?.trim()) {
      await db.update(tTags).set({ name: name.trim() }).where(and(eq(tTags.team_id, teamId), eq(tTags.name, oldName)));
    }
    if (color !== undefined) {
      await db.update(tTags).set({ color }).where(and(eq(tTags.team_id, teamId), eq(tTags.name, (name?.trim() || oldName))));
    }
    res.json({ code: 200, message: 'Tag updated' });
    return;
  }
  if (req.method === 'DELETE') {
    const segs = req.path.replace(/^\//, '').split('/').filter(Boolean);
    const name = decodeURIComponent(segs[1] ?? '');
    await db.delete(tTags).where(and(eq(tTags.team_id, teamId), eq(tTags.name, name)));
    res.json({ code: 200, message: `Tag "${name}" deleted successfully` });
    return;
  }
  res.status(405).json({ code: 405, message: 'Method not allowed' });
}

// ── dashboard (team-mode zeros until center executions exist) ──────────────

async function handleDashboard(_req: Request, res: Response, _projectId: number): Promise<void> {
  const sub = _req.path.replace(/^\/dashboard\/?/, '');
  if (sub === 'recent-executions' || sub === 'pending') {
    res.json({ code: 200, message: 'ok', data: [] });
    return;
  }
  if (sub === 'trend') {
    res.json({ code: 200, message: 'ok', data: { items: [] } });
    return;
  }
  const zero = { totalCases: 0, activeCases: 0, totalSets: 0, passRate: 0, todayExecutions: 0, weekExecutions: 0 };
  res.json({ code: 200, message: 'ok', data: { 'api-test': zero, 'web-test': zero, 'mobile-test': zero, 'pc-test': zero } });
}

export { RESOURCES as TEAM_RESOURCES };
