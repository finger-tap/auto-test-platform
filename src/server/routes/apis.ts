import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { findApisByUserIdPaginated, findApisByUserId, findApiById, createApi, updateApi, deleteApi, findApiExecutionsByApiId, findApiExecutionWithSteps, createApiExecution, type ApiRow, type ApiExecutionRow, type ApiListFilter } from '../db/apis.js';
import type { AssertionRule } from '../db/apis.js';
import { executeApi, evaluateAssertions } from '../engine/api-executor.js';
import { evalBuiltin } from '../engine/builtins.js';
import { findUserById } from '../db/users.js';
import { executeWsSession } from '../engine/ws-executor.js';

export const apiRoutes = Router();
apiRoutes.use(authMiddleware);

const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// ── WebSocket Executor ──────────────────────────────────

async function executeWs(api: ApiRow, req: Request, res: Response) {
  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';
  const start = Date.now();

  // Load environment
  const envContext: Record<string, string> = {};
  let sslCert: string | undefined;
  let sslKey: string | undefined;
  let envTimeout: number | undefined;
  let allDbConfigs: Record<string, import('../db/environments.js').DbConfig> | null = null;

  if (req.body.environmentId) {
    const { findEnvById, envToMap, envToDbConfigs, envToSslCerts } = await import('../db/environments.js');
    const env = findEnvById(Number(req.body.environmentId), req.user!.userId);
    if (env) {
      Object.assign(envContext, envToMap(env));
      // Prefer ssl_certs array; look up by api.ssl_cert_name, fall back to first
      const certs = envToSslCerts(env);
      const certName = api.ssl_cert_name;
      const target = certName ? certs.find(c => c.name === certName) : certs[0];
      if (target) {
        sslCert = target.cert;
        sslKey = target.key;
      } else if (env.ssl_cert) {
        sslCert = env.ssl_cert;
        sslKey = env.ssl_key || undefined;
      }
      if (env.timeout) envTimeout = env.timeout;
      allDbConfigs = envToDbConfigs(env);
    }
  }

  // Pre-script (WS doesn't have pre-db-query/pre-db-name separate fields, use pre_script directly)
  const scriptVars: Record<string, string> = { ...envContext };
  let preError: string | null = null;

  if (api.pre_script && api.pre_script.trim()) {
    const { executeScript } = await import('../db/scripts/pre-post.js');
    const preResult = await executeScript(api.pre_script, {
      vars: { ...envContext },
      env: envContext,
      prevApi: undefined,
      dbConfigs: allDbConfigs,
    });
    if (!preResult.success) {
      preError = `前置脚本错误: ${preResult.error}`;
    } else if (preResult.vars) {
      Object.assign(scriptVars, preResult.vars);
    }
  }

  // Pre assertions
  let preAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
  if (api.pre_assertions && !preError) {
    try {
      const preRules: AssertionRule[] = JSON.parse(api.pre_assertions);
      const { results, extracted } = evaluateAssertions(preRules, 0, {}, JSON.stringify({ vars: scriptVars }));
      preAssertResults = results;
      Object.assign(scriptVars, extracted);
    } catch { /* ignore */ }
  }

  // WebSocket session (single round-trip)
  let wsResult: import('../engine/ws-executor.js').WsExecutionResult;
  try {
    const url = evalBuiltin(api.url, scriptVars);
    wsResult = await executeWsSession(
      url,
      api.ws_send || '',
      api.ws_expect ? JSON.parse(api.ws_expect) : [],
      sslCert,
      sslKey,
      envTimeout || 30000,
      scriptVars
    );
  } catch (err) {
    const duration = Date.now() - start;
    const execId = createApiExecution({
      api_id: api.id,
      status: 'error',
      executed_by: executedBy,
      request_headers: '[]',
      request_body: null,
      response_headers: null,
      response_body: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      duration_ms: duration,
      error_message: err instanceof Error ? err.message : 'Unknown error',
      started_at: new Date(start).toISOString(),
      finished_at: new Date().toISOString(),
    });
    res.json({
      code: 200, message: 'ok', data: {
        id: execId, api_id: api.id, status_code: 0,
        request_headers: '[]', request_body: null, response_headers: null,
        response_body: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error', ws_session: true }),
        duration_ms: duration, executed_by: executedBy,
        assertion_results: { pre: preAssertResults, main: [], post: [], final: [], ws: { connected: false } },
        script_error: preError || undefined,
        execution_id: execId,
      },
    });
    return;
  }

  const duration = Date.now() - start;

  // Post assertions
  let postAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
  if (api.post_assertions && api.post_script && !preError) {
    try {
      const postRules: AssertionRule[] = JSON.parse(api.post_assertions);
      const { results, extracted } = evaluateAssertions(
        postRules,
        wsResult.connected ? 101 : 0,
        { 'sec-websocket-protocol': 'ws-received' },
        wsResult.received || ''
      );
      postAssertResults = results;
      Object.assign(scriptVars, extracted);
    } catch { /* ignore */ }
  }

  // Final assertions
  let finalAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
  if (api.final_assertions) {
    try {
      const finalRules: AssertionRule[] = JSON.parse(api.final_assertions);
      const { results, extracted } = evaluateAssertions(
        finalRules,
        wsResult.connected ? 101 : 0,
        { 'sec-websocket-protocol': 'ws-received' },
        wsResult.received || ''
      );
      finalAssertResults = results;
      Object.assign(scriptVars, extracted);
    } catch { /* ignore */ }
  }

  const respBody = JSON.stringify({
    connected: wsResult.connected,
    sent: wsResult.sent,
    received: wsResult.received,
    error: wsResult.error_message,
  }, null, 2);

  const execId = createApiExecution({
    api_id: api.id,
    status: wsResult.connected ? 'success' : 'error',
    executed_by: executedBy,
    request_headers: JSON.stringify([]),
    request_body: api.ws_send || null,
    response_headers: JSON.stringify({ 'sec-websocket-protocol': 'ws-received' }),
    response_body: respBody,
    duration_ms: duration,
    error_message: wsResult.error_message || null,
    started_at: new Date(start).toISOString(),
    finished_at: new Date().toISOString(),
  });

  res.json({
    code: 200, message: 'ok', data: {
      id: execId, api_id: api.id,
      status_code: wsResult.connected ? 101 : 0,
      request_headers: JSON.stringify([]),
      request_body: api.ws_send || null,
      response_headers: JSON.stringify({ 'sec-websocket-protocol': 'ws-received' }),
      response_body: respBody,
      duration_ms: duration, executed_by: executedBy,
      assertion_results: {
        pre: preAssertResults, post: postAssertResults, final: finalAssertResults,
        ws: { connected: wsResult.connected, sent: wsResult.sent, received: wsResult.received, assertion_results: wsResult.assertion_results, error_message: wsResult.error_message },
      },
      script_error: preError || undefined,
      execution_id: execId,
    },
  });
}

// GET /api/apis
apiRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters: ApiListFilter = {
    name: req.query.name as string | undefined,
    description: req.query.description as string | undefined,
    tag: req.query.tag as string | undefined,
    status: req.query.status as string | undefined,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
  };
  const result = findApisByUserIdPaginated(req.user!.userId, page, pageSize, sort, order, filters);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/apis
apiRoutes.post('/', (req: Request, res: Response) => {
  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions, parameters, ssl_cert_name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }
  if (!method || !VALID_METHODS.includes(method)) {
    res.status(400).json({ code: 400, message: 'Method must be one of: GET, POST, PUT, DELETE, PATCH' });
    return;
  }
  if (!url || typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ code: 400, message: 'URL is required' });
    return;
  }

  const id = createApi(req.user!.userId, { name: name.trim(), method, url: url.trim(), protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions, parameters, ssl_cert_name });
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// Helper: check ownership
function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const api = findApiById(id);
  if (!api) {
    res.status(404).json({ code: 404, message: 'API not found' });
    return null;
  }
  if (api.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return api;
}

// GET /api/apis/:id
apiRoutes.get('/:id', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;
  res.json({ code: 200, message: 'ok', data: api });
});

// PUT /api/apis/:id
apiRoutes.put('/:id', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions, parameters, ssl_cert_name } = req.body;
  if (method && !VALID_METHODS.includes(method)) {
    res.status(400).json({ code: 400, message: 'Invalid method' });
    return;
  }

  updateApi(api.id, { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions, parameters, ssl_cert_name });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/apis/:id
apiRoutes.delete('/:id', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  deleteApi(api.id);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/apis/:id/execute
apiRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  // ── WebSocket protocol execution ──
  if (api.protocol === 'ws' || api.protocol === 'wss') {
    await executeWs(api, req, res);
    return;
  }

  // ── HTTP/HTTPS protocol execution ──
  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  // Load environment
  const envContext: Record<string, string> = {};
  let sslCert: string | undefined;
  let sslKey: string | undefined;
  let envTimeout: number | undefined;

  if (req.body.environmentId) {
    const { findEnvById, envToMap, envToDbConfigs, envToSslCerts } = await import('../db/environments.js');
    const env = findEnvById(Number(req.body.environmentId), req.user!.userId);
    if (env) {
      Object.assign(envContext, envToMap(env));
      // Prefer ssl_certs array; look up by api.ssl_cert_name, fall back to first
      const certs = envToSslCerts(env);
      const certName = api.ssl_cert_name;
      const target = certName ? certs.find(c => c.name === certName) : certs[0];
      if (target) {
        sslCert = target.cert;
        sslKey = target.key;
      } else if (env.ssl_cert) {
        // Legacy single cert fallback
        sslCert = env.ssl_cert;
        sslKey = env.ssl_key || undefined;
      }
      if (env.timeout) envTimeout = env.timeout;
    }
  }

  // ── Execute via new engine ──
  try {
    const paramConfig = api.parameters ? JSON.parse(api.parameters) : null;
    const results = await executeApi(api.id, envContext, undefined, undefined, {
      sslCert, sslKey, timeout: envTimeout, executedBy, paramConfig,
    });

    // Build response from results (backward compatible shape)
    const first = results[0];
    const allRows = results.map(r => ({
      row: r.param_row_index,
      status: r.status_code,
      duration_ms: r.duration_ms,
      passed: r.assertion_results.main.filter(a => a.passed).length,
      failed: r.assertion_results.main.filter(a => !a.passed).length,
    }));
    const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0);

    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: first?.execution_id,
        api_id: api.id,
        status_code: first?.status_code,
        request_headers: JSON.stringify(first?.request_headers || {}),
        request_body: first?.request_body,
        response_headers: JSON.stringify(first?.response_headers || {}),
        response_body: first?.response_body,
        duration_ms: totalDuration,
        executed_by: executedBy,
        assertion_results: first?.assertion_results,
        param_summary: { total_rows: results.length, results: allRows },
        // Include new execution_id for drill-down
        execution_id: first?.execution_id,
        steps: first?.steps,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ code: 500, message: errorMsg });
  }
});

// GET /api/apis/:id/logs — list executions (new table)
apiRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const executions = findApiExecutionsByApiId(api.id, limit);
  res.json({ code: 200, message: 'ok', data: executions });
});

// GET /api/apis/:id/executions — list all execution sessions (new table)
apiRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const allExecutions = findApiExecutionsByApiId(api.id, limit);
  console.log('[executions] apiId:', api.id, 'count:', allExecutions.length, 'executions:', allExecutions.map(e => ({ id: e.id, batch_id: e.batch_id, param_row_index: e.param_row_index })));

  // Group into batches:
  // - batch_id === id → batch leader (show as entry, with sub_executions)
  // - batch_id === -1 → standalone single execution
  // - batch_id !== id && batch_id !== -1 → batch member (hidden, attached to leader)

  // Build result: group all by batch_id, each group becomes one entry with sub_executions
  const batchMap = new Map<number, ApiExecutionRow & { sub_executions: ApiExecutionRow[] }>();
  const standalone: ApiExecutionRow[] = [];

  for (const exec of allExecutions) {
    if (exec.batch_id === -1) {
      standalone.push(exec);
    } else {
      const batchKey = exec.batch_id;
      if (!batchMap.has(batchKey)) {
        batchMap.set(batchKey, { ...exec, sub_executions: [] });
      } else {
        batchMap.get(batchKey)!.sub_executions.push(exec);
      }
    }
  }

  const result = Array.from(batchMap.values()).map(entry => ({
    ...entry,
    sub_executions: entry.sub_executions.sort((a, b) => a.param_row_index - b.param_row_index),
  }));

  result.push(...standalone.map(s => ({ ...s, sub_executions: [] as ApiExecutionRow[] })));

  res.json({ code: 200, message: 'ok', data: result });
});

// GET /api/apis/:id/executions/:execId — get execution detail with steps
apiRoutes.get('/:id/executions/:execId', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const execId = Number(req.params.execId);
  if (!execId) { res.status(400).json({ code: 400, message: 'Invalid execId' }); return; }

  const detail = findApiExecutionWithSteps(execId);
  if (!detail) { res.status(404).json({ code: 404, message: 'Execution not found' }); return; }
  res.json({ code: 200, message: 'ok', data: detail });
});
