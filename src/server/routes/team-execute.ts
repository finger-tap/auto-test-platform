import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import db from '../db/index.js';
import { getTeamDb } from '../db-team/client.js';
import {
  tApis, tScenarios, tScenarioNodes, tScenarioEdges,
  tWebCases, tPcCases, tMobileCases, tEnvironments, tDevices,
} from '../db-team/schema/index.js';
import { TeamApiError, nowSql } from '../db-team/util.js';
import { findUserById, createUser } from '../db/users.js';
import { findEnvById, envToMap, envToSslCerts, envToDbConfigs } from '../db/environments.js';
import { executeApi } from '../engine/api-executor.js';
import { executeWebCase } from '../engine/web-executor.js';
import { executePcCase } from '../engine/pc-executor.js';
import { executeMobileTest } from '../engine/mobile-executor.js';
import { executeWs } from './apis.js';
import {
  createWebCaseExecution, finishWebCaseExecution, createWebCaseLog,
  findWebCaseExecutionsByCaseId, findLogsByWebCaseId,
} from '../db/web-cases.js';
import {
  createPcCaseExecution, finishPcCaseExecution, createPcCaseLog,
  findPcCaseExecutionsByCaseId, findLogsByPcCaseId,
} from '../db/pc-cases.js';
import {
  createMobileCaseExecution, finishMobileCaseExecution, createMobileTestLog,
  findMobileCaseExecutionsByCaseId, findLogsByMobileTestCaseId,
} from '../db/mobile-tests.js';
import { findApiExecutionsByApiId } from '../db/apis.js';
import { findLogsByScenarioId as findScenarioLogsByScenarioId, findScenarioExecutionsByScenarioId } from '../db/scenarios.js';
import { relativeReportUrl } from '../engine/report-paths.js';

/**
 * Team-mode EXECUTION BRIDGE.
 *
 * The center deployment is a normal instance of this codebase — it has the
 * full executor stack in-process (Playwright, ADB, report writer, devices
 * table...). Rather than rewriting four executors to talk to TiDB, we MIRROR
 * the team case row into the local SQLite (owned by a dedicated "host" user),
 * run the existing executor untouched, and map ids back for /logs and
 * /executions. Everything that works locally (reports, agents, devices)
 * therefore works in team mode, on the machine that runs the center.
 *
 * Mirrors are content-addressed by (resource_type, team_case_id) and refreshed
 * on every execute — they are caches, not a second source of truth.
 */

// ── mirror table ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS team_case_mirror (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL,
    team_case_id INTEGER NOT NULL,
    local_case_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
    UNIQUE(resource_type, team_case_id)
  );
`);

const colsCache = new Map<string, Set<string>>();
function sqliteCols(table: string): Set<string> {
  let cols = colsCache.get(table);
  if (!cols) {
    cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    colsCache.set(table, cols);
  }
  return cols;
}

/** Host user = the local account whose per-user configs (model, browser) drive team executions. */
let _hostUserId: number | null = null;
export function hostUserId(): number {
  if (_hostUserId) return _hostUserId;
  const row = db
    .prepare("SELECT id FROM users WHERE account_type != 'guest' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (row) {
    _hostUserId = row.id;
  } else {
    _hostUserId = createUser('__team_host__', randomBytes(24).toString('hex'), 'email', '团队执行宿主');
  }
  return _hostUserId;
}

function mirrorLocalId(resourceType: string, teamCaseId: number): number | null {
  const row = db
    .prepare('SELECT local_case_id FROM team_case_mirror WHERE resource_type = ? AND team_case_id = ?')
    .get(resourceType, teamCaseId) as { local_case_id: number } | undefined;
  return row?.local_case_id ?? null;
}

/** Upsert a TiDB row into its local SQLite mirror table. Returns the local id. */
function upsertMirror(resourceType: string, sqliteTable: string, teamCaseId: number, teamRow: Record<string, unknown>): number {
  const cols = sqliteCols(sqliteTable);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const col of cols) {
    if (col === 'id') continue;
    if (col === 'user_id') { fields.push('user_id'); values.push(hostUserId()); continue; }
    if (col === 'created_at' || col === 'updated_at') { fields.push(col); values.push(nowSql()); continue; }
    fields.push(col);
    values.push(teamRow[col] ?? null);
  }

  const existingLocal = mirrorLocalId(resourceType, teamCaseId);
  if (existingLocal) {
    const stillThere = db.prepare(`SELECT id FROM ${sqliteTable} WHERE id = ?`).get(existingLocal);
    if (stillThere) {
      db.prepare(`UPDATE ${sqliteTable} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
        .run(...values, existingLocal);
      db.prepare("UPDATE team_case_mirror SET updated_at = datetime('now','+8 hours') WHERE resource_type = ? AND team_case_id = ?")
        .run(resourceType, teamCaseId);
      return existingLocal;
    }
  }

  const ins = db.prepare(`INSERT INTO ${sqliteTable} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...values);
  const localId = Number(ins.lastInsertRowid);
  db.prepare('INSERT OR REPLACE INTO team_case_mirror (resource_type, team_case_id, local_case_id) VALUES (?, ?, ?)')
    .run(resourceType, teamCaseId, localId);
  return localId;
}

function removeMirror(resourceType: string, teamCaseId: number): void {
  const local = mirrorLocalId(resourceType, teamCaseId);
  if (local === null) return;
  const table = MIRROR_TABLES[resourceType];
  if (table) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(local);
  db.prepare('DELETE FROM team_case_mirror WHERE resource_type = ? AND team_case_id = ?').run(resourceType, teamCaseId);
}

const MIRROR_TABLES: Record<string, string> = {
  api: 'apis', scenario: 'scenarios', web_case: 'web_test_cases',
  pc_case: 'pc_test_cases', mobile_case: 'mobile_test_cases',
  environment: 'environments', device: 'devices',
};

// ── team row loaders ───────────────────────────────────────────────────────

async function teamRow(table: typeof tApis | typeof tScenarios | typeof tWebCases | typeof tPcCases | typeof tMobileCases | typeof tEnvironments | typeof tDevices, teamId: number, projectId: number, id: number): Promise<Record<string, unknown> | undefined> {
  const dbT = getTeamDb()!;
  const t = table as unknown as Record<string, never>;
  const rows = await dbT.select().from(table as never)
    .where(and(eq(t.team_id as never, teamId), eq(t.project_id as never, projectId), eq(t.id as never, id)))
    .limit(1);
  return (rows as unknown as Record<string, unknown>[])[0];
}

/** Mirror the environment referenced by body.environmentId (team id → local id). */
async function mirrorEnvironment(req: Request, teamId: number, projectId: number): Promise<number | undefined> {
  const envId = Number((req.body as Record<string, unknown>)?.environmentId);
  if (!Number.isInteger(envId) || envId <= 0) return undefined;
  const env = await teamRow(tEnvironments, teamId, projectId, envId);
  if (!env) return undefined;
  return upsertMirror('environment', 'environments', envId, env);
}

/** Mirror the device referenced by ?deviceId (team id → local id). */
async function mirrorDevice(req: Request, teamId: number, projectId: number): Promise<number | undefined> {
  const deviceId = Number(req.query.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return undefined;
  const dev = await teamRow(tDevices, teamId, projectId, deviceId);
  if (!dev) return undefined;
  return upsertMirror('device', 'devices', deviceId, dev);
}

function envContextFor(localEnvId: number | undefined) {
  if (!localEnvId) return { envContext: {} as Record<string, string>, sslCert: undefined, sslKey: undefined, envTimeout: undefined as number | undefined, dbConfigs: null };
  const env = findEnvById(localEnvId, hostUserId());
  if (!env) return { envContext: {} as Record<string, string>, sslCert: undefined, sslKey: undefined, envTimeout: undefined as number | undefined, dbConfigs: null };
  return {
    envContext: envToMap(env),
    sslCert: undefined as string | undefined,
    sslKey: undefined as string | undefined,
    envTimeout: env.timeout || undefined,
    dbConfigs: envToDbConfigs(env),
  };
}

// ── execute: api ───────────────────────────────────────────────────────────

export async function executeTeamApi(req: Request, res: Response, teamId: number, projectId: number, id: number): Promise<void> {
  const row = await teamRow(tApis, teamId, projectId, id);
  if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }
  const localApiId = upsertMirror('api', 'apis', id, row);

  if (String(row.protocol) === 'ws' || String(row.protocol) === 'wss') {
    const localEnvId = await mirrorEnvironment(req, teamId, projectId);
    const shimReq = {
      body: { ...(req.body as object), environmentId: localEnvId },
      user: { userId: hostUserId(), account: 'team' },
    } as unknown as Request;
    await executeWs(
      db.prepare('SELECT * FROM apis WHERE id = ?').get(localApiId) as never,
      shimReq,
      res,
    );
    return;
  }

  const localEnvId = await mirrorEnvironment(req, teamId, projectId);
  const { envContext } = envContextFor(localEnvId);

  try {
    const paramConfig = row.parameters ? JSON.parse(String(row.parameters)) : null;
    const results = await executeApi(localApiId, envContext, undefined, undefined, {
      executedBy: req.teamUser!.account,
      paramConfig,
    });
    const first = results[0];
    const allRows = results.map((r) => ({
      row: r.param_row_index,
      status: r.status_code,
      duration_ms: r.duration_ms,
      passed: r.assertion_results.main.filter((a) => a.passed).length,
      failed: r.assertion_results.main.filter((a) => !a.passed).length,
    }));
    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: first?.execution_id,
        api_id: id,
        status_code: first?.status_code,
        request_headers: JSON.stringify(first?.request_headers || {}),
        request_body: first?.request_body,
        response_headers: JSON.stringify(first?.response_headers || {}),
        response_body: first?.response_body,
        duration_ms: results.reduce((s, r) => s + r.duration_ms, 0),
        executed_by: req.teamUser!.account,
        assertion_results: first?.assertion_results,
        param_summary: { total_rows: results.length, results: allRows },
        execution_id: first?.execution_id,
        steps: first?.steps,
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : 'Unknown error' });
  }
}

// ── execute: scenario ──────────────────────────────────────────────────────

export async function executeTeamScenario(req: Request, res: Response, teamId: number, projectId: number, id: number): Promise<void> {
  const row = await teamRow(tScenarios, teamId, projectId, id);
  if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }

  const localId = upsertMirror('scenario', 'scenarios', id, row);
  const dbT = getTeamDb()!;
  const nodes = await dbT.select().from(tScenarioNodes).where(eq(tScenarioNodes.scenario_id, id));
  const edges = await dbT.select().from(tScenarioEdges).where(eq(tScenarioEdges.scenario_id, id));

  // refresh nodes/edges mirror
  db.prepare('DELETE FROM scenario_nodes WHERE scenario_id = ?').run(localId);
  db.prepare('DELETE FROM scenario_edges WHERE scenario_id = ?').run(localId);
  const now = nowSql();
  for (const n of nodes) {
    db.prepare(`INSERT INTO scenario_nodes (scenario_id, node_id, type, position_x, position_y, label, config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(localId, n.node_id, n.type, n.position_x, n.position_y, n.label, n.config, now, now);
  }
  for (const e of edges) {
    db.prepare(`INSERT INTO scenario_edges (scenario_id, edge_id, source_node_id, target_node_id, source_handle, label, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(localId, e.edge_id, e.source_node_id, e.target_node_id, e.source_handle, e.label, now);
  }

  const localEnvId = await mirrorEnvironment(req, teamId, projectId);
  try {
    const { executeScenario } = await import('../engine/executor.js');
    const result = await executeScenario(localId, req.teamUser!.account, localEnvId);
    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : '执行失败' });
  }
}

// ── execute: web / pc / mobile ─────────────────────────────────────────────

export async function executeTeamWebCase(req: Request, res: Response, teamId: number, projectId: number, id: number): Promise<void> {
  const row = await teamRow(tWebCases, teamId, projectId, id);
  if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }
  const localId = upsertMirror('web_case', 'web_test_cases', id, row);
  const mirrorWebCase = db.prepare('SELECT * FROM web_test_cases WHERE id = ?').get(localId) as Record<string, unknown>;

  const localDeviceId = await mirrorDevice(req, teamId, projectId);
  if (localDeviceId) {
    const { findRunningWebExecutionByDevice } = await import('../db/web-cases.js');
    if (findRunningWebExecutionByDevice(localDeviceId)) {
      res.status(409).json({ code: 409, message: '该设备正在执行其他任务，请稍后再试' });
      return;
    }
  }

  const startedAt = new Date().toISOString();
  const execId = createWebCaseExecution(localId, hostUserId(), {
    started_at: startedAt,
    executed_by: req.teamUser!.account,
    device_id: localDeviceId,
  });

  const localEnvId = await mirrorEnvironment(req, teamId, projectId);
  const { envContext } = envContextFor(localEnvId);

  let result: Awaited<ReturnType<typeof executeWebCase>>;
  try {
    result = await executeWebCase(mirrorWebCase as never, {
      executedBy: req.teamUser!.account,
      caseId: localId,
      execId,
      userId: hostUserId(),
      deviceId: localDeviceId,
      envVars: Object.keys(envContext).length > 0 ? envContext : undefined,
    });
  } catch (err) {
    finishWebCaseExecution(execId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      report_path: null, report_type: null,
      error_message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ code: 500, message: '执行异常', data: { error_message: err instanceof Error ? err.message : String(err) } });
    return;
  }

  finishWebCaseExecution(execId, {
    status: result.status,
    finished_at: new Date().toISOString(),
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });
  createWebCaseLog(localId, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: req.teamUser!.account,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
  });

  res.json({
    code: 200,
    message: 'ok',
    data: {
      ...result,
      caseId: id,
      execution_id: execId,
      report_url: result.report_path ? relativeReportUrl('web', localId, execId) : null,
    },
  });
}

export async function executeTeamPcCase(req: Request, res: Response, teamId: number, projectId: number, id: number): Promise<void> {
  const row = await teamRow(tPcCases, teamId, projectId, id);
  if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }
  const localId = upsertMirror('pc_case', 'pc_test_cases', id, row);
  const mirrorPcCase = db.prepare('SELECT * FROM pc_test_cases WHERE id = ?').get(localId) as Record<string, unknown>;

  const localDeviceId = await mirrorDevice(req, teamId, projectId);
  if (localDeviceId) {
    const { findRunningPcExecutionByDevice } = await import('../db/pc-cases.js');
    if (findRunningPcExecutionByDevice(localDeviceId)) {
      res.status(409).json({ code: 409, message: '该设备正在执行其他任务，请稍后再试' });
      return;
    }
  }

  const startedAt = new Date().toISOString();
  const execId = createPcCaseExecution(localId, hostUserId(), {
    started_at: startedAt,
    executed_by: req.teamUser!.account,
    device_id: localDeviceId ?? null,
  });

  const localEnvId = await mirrorEnvironment(req, teamId, projectId);
  const { envContext } = envContextFor(localEnvId);

  let result: Awaited<ReturnType<typeof executePcCase>>;
  try {
    result = await executePcCase(mirrorPcCase as never, {
      executedBy: req.teamUser!.account,
      caseId: localId,
      execId,
      deviceId: localDeviceId,
      userId: hostUserId(),
      envVars: Object.keys(envContext).length > 0 ? envContext : undefined,
    });
  } catch (err) {
    finishPcCaseExecution(execId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      report_path: null, report_type: null,
      error_message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ code: 500, message: '执行异常', data: { error_message: err instanceof Error ? err.message : String(err) } });
    return;
  }

  finishPcCaseExecution(execId, {
    status: result.status,
    finished_at: new Date().toISOString(),
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });
  createPcCaseLog(localId, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: req.teamUser!.account,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
  });

  res.json({
    code: 200,
    message: 'ok',
    data: { ...result, caseId: id, execution_id: execId },
  });
}

export async function executeTeamMobileCase(req: Request, res: Response, teamId: number, projectId: number, id: number): Promise<void> {
  const row = await teamRow(tMobileCases, teamId, projectId, id);
  if (!row) { res.status(404).json({ code: 404, message: '不存在' }); return; }
  const localId = upsertMirror('mobile_case', 'mobile_test_cases', id, row);
  const mirrorCase = db.prepare('SELECT * FROM mobile_test_cases WHERE id = ?').get(localId) as Record<string, unknown>;

  const localDeviceId = await mirrorDevice(req, teamId, projectId);
  if (!localDeviceId) {
    res.status(400).json({ code: 400, message: '团队模式执行移动端用例需选择远程设备（本机直连设备属于个人空间）' });
    return;
  }

  const startedAt = new Date().toISOString();
  let execId: number;
  try {
    execId = createMobileCaseExecution(localId, hostUserId(), {
      started_at: startedAt,
      executed_by: req.teamUser!.account,
      device_id: localDeviceId,
      local_device_key: null,
    });
  } catch (e) {
    res.status(409).json({ code: 409, message: '设备正被其他会话占用' });
    return;
  }

  const localEnvId = await mirrorEnvironment(req, teamId, projectId);
  const { envContext } = envContextFor(localEnvId);

  let result: Awaited<ReturnType<typeof executeMobileTest>>;
  try {
    result = await executeMobileTest(mirrorCase as never, {
      executedBy: req.teamUser!.account,
      deviceId: localDeviceId,
      userId: hostUserId(),
      caseId: localId,
      execId,
      envVars: Object.keys(envContext).length > 0 ? envContext : undefined,
    });
  } catch (err) {
    finishMobileCaseExecution(execId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      report_path: null, report_type: null,
      error_message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ code: 500, message: '执行异常', data: { error_message: err instanceof Error ? err.message : String(err) } });
    return;
  }

  finishMobileCaseExecution(execId, {
    status: result.status,
    finished_at: new Date().toISOString(),
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });
  createMobileTestLog(localId, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: req.teamUser!.account,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
    screenshots: null,
  });

  res.json({
    code: 200,
    message: 'ok',
    data: { ...result, caseId: id, execution_id: execId },
  });
}

// ── logs / executions read-through (SQLite mirror → team ids) ─────────────

function rewriteIds(value: unknown, localId: number, teamId_: number, deviceMap: Map<number, number> | null): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, localId, teamId_, deviceMap));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((k === 'api_id' || k === 'case_id' || k === 'scenario_id') && v === localId) {
        out[k] = teamId_;
      } else if (k === 'device_id' && deviceMap && typeof v === 'number' && deviceMap.has(v)) {
        out[k] = deviceMap.get(v);
      } else {
        out[k] = rewriteIds(v, localId, teamId_, deviceMap);
      }
    }
    return out;
  }
  return value;
}

/** Reverse map: local device id → team device id (all mirrors of this team). */
function deviceReverseMap(): Map<number, number> {
  const rows = db
    .prepare("SELECT team_case_id, local_case_id FROM team_case_mirror WHERE resource_type = 'device'")
    .all() as Array<{ team_case_id: number; local_case_id: number }>;
  return new Map(rows.map((r) => [r.local_case_id, r.team_case_id]));
}

export async function teamLogsAndExecutions(req: Request, res: Response, teamId: number, projectId: number, resourceType: string, teamCaseId: number, sub: string): Promise<boolean> {
  const localId = mirrorLocalId(resourceType, teamCaseId);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const dmap = deviceReverseMap();

  const mapOut = (items: unknown[]) => items.map((it) => rewriteIds(it, localId ?? -1, teamCaseId, dmap));

  if (resourceType === 'api') {
    const rows = findApiExecutionsByApiId(localId ?? -1, limit);
    res.json({ code: 200, message: 'ok', data: mapOut(rows) });
    return true;
  }
  if (resourceType === 'scenario') {
    const rows = sub === 'logs'
      ? findScenarioLogsByScenarioId(localId ?? -1, limit)
      : findScenarioExecutionsByScenarioId(localId ?? -1, limit);
    res.json({ code: 200, message: 'ok', data: mapOut(rows) });
    return true;
  }
  if (resourceType === 'web_case') {
    if (sub === 'logs') {
      res.json({ code: 200, message: 'ok', data: mapOut(findLogsByWebCaseId(localId ?? -1, limit)) });
      return true;
    }
    const rows = findWebCaseExecutionsByCaseId(localId ?? -1, limit)
      .map((e) => ({
        ...e,
        report_url: e.report_path ? relativeReportUrl('web', localId!, e.id) : null,
      }));
    res.json({ code: 200, message: 'ok', data: mapOut(rows) });
    return true;
  }
  if (resourceType === 'pc_case') {
    if (sub === 'logs') {
      res.json({ code: 200, message: 'ok', data: mapOut(findLogsByPcCaseId(localId ?? -1, limit)) });
      return true;
    }
    const rows = findPcCaseExecutionsByCaseId(localId ?? -1, limit);
    res.json({ code: 200, message: 'ok', data: mapOut(rows) });
    return true;
  }
  if (resourceType === 'mobile_case') {
    if (sub === 'logs') {
      res.json({ code: 200, message: 'ok', data: mapOut(findLogsByMobileTestCaseId(localId ?? -1, limit)) });
      return true;
    }
    const rows = findMobileCaseExecutionsByCaseId(localId ?? -1, limit);
    res.json({ code: 200, message: 'ok', data: mapOut(rows) });
    return true;
  }
  return false;
}

void removeMirror; void TeamApiError; void findUserById; void envToSslCerts;
