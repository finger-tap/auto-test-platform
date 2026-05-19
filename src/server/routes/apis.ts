import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { findApisByUserIdPaginated, findApisByUserId, findApiById, createApi, updateApi, deleteApi, createApiLog, findLogsByApiId, type ApiRow } from '../db/apis.js';
import type { AssertionRule } from '../db/apis.js';
import { evaluateAssertions } from '../engine/api-executor.js';
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
    const { findEnvById, envToMap, envToDbConfigs } = await import('../db/environments.js');
    const env = findEnvById(Number(req.body.environmentId), req.user!.userId);
    if (env) {
      Object.assign(envContext, envToMap(env));
      if (env.ssl_cert) sslCert = env.ssl_cert;
      if (env.ssl_key) sslKey = env.ssl_key;
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
    const logId = createApiLog(api.id, {
      status_code: 0,
      request_headers: '[]',
      request_body: null,
      response_headers: null,
      response_body: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      duration_ms: duration,
      executed_by: executedBy,
      assertion_results: JSON.stringify({ pre: preAssertResults, post: [], final: [] }),
    });
    res.json({
      code: 200, message: 'ok', data: {
        id: logId, api_id: api.id, status_code: 0,
        request_headers: '[]', request_body: null, response_headers: null,
        response_body: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error', ws_session: true }),
        duration_ms: duration, executed_by: executedBy,
        assertion_results: { pre: preAssertResults, post: [], final: [], ws: { connected: false } },
        script_error: preError || undefined,
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

  const logId = createApiLog(api.id, {
    status_code: wsResult.connected ? 101 : 0,
    request_headers: JSON.stringify([]),
    request_body: api.ws_send || null,
    response_headers: JSON.stringify({ 'sec-websocket-protocol': 'ws-received' }),
    response_body: respBody,
    duration_ms: duration,
    executed_by: executedBy,
    assertion_results: JSON.stringify({ pre: preAssertResults, post: postAssertResults, final: finalAssertResults }),
  });

  res.json({
    code: 200, message: 'ok', data: {
      id: logId, api_id: api.id,
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
    },
  });
}

// GET /api/apis
apiRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const { items, total } = findApisByUserIdPaginated(req.user!.userId, page, pageSize, sort, order);
  res.json({ code: 200, message: 'ok', data: { items, total, page, pageSize } });
});

// POST /api/apis
apiRoutes.post('/', (req: Request, res: Response) => {
  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions } = req.body;

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

  const id = createApi(req.user!.userId, { name: name.trim(), method, url: url.trim(), protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions });
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

  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions } = req.body;
  if (method && !VALID_METHODS.includes(method)) {
    res.status(400).json({ code: 400, message: 'Invalid method' });
    return;
  }

  updateApi(api.id, { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions, pre_script, post_script, pre_db_name, pre_db_query, post_db_name, post_db_query, pre_assertions, post_assertions, final_assertions, ws_send, ws_expect, pre_actions, post_actions });
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
  let allDbConfigs: Record<string, import('../db/environments.js').DbConfig> | null = null;

  if (req.body.environmentId) {
    const { findEnvById, envToMap, envToDbConfigs } = await import('../db/environments.js');
    const env = findEnvById(Number(req.body.environmentId), req.user!.userId);
    if (env) {
      Object.assign(envContext, envToMap(env));
      if (env.ssl_cert) sslCert = env.ssl_cert;
      if (env.ssl_key) sslKey = env.ssl_key;
      if (env.timeout) envTimeout = env.timeout;
      allDbConfigs = envToDbConfigs(env);
    }
  }

  // ── Substitution helper: supports {{var}} using envContext + scriptVars ──
  const scriptVars: Record<string, string> = {};
  function substitute(text: string): string {
    return evalBuiltin(text, { ...envContext, ...scriptVars });
  }

  const start = Date.now();

  // ── Step 1: Pre-script (legacy or new action format) ──
  let preError: string | null = null;

  let effectivePreScript = api.pre_script || '';

  // Support new action format: pre_actions is JSON array of {type, script, dbName, dbQuery}
  if (api.pre_actions) {
    try {
      const actions = JSON.parse(api.pre_actions) as Array<{ type: string; script?: string; dbName?: string; dbQuery?: string }>;
      for (const action of actions) {
        if (action.type === 'db' && action.dbQuery?.trim()) {
          const q = action.dbQuery.trim().replace(/;$/, '');
          effectivePreScript += `\n// [数据库查询] ${action.dbName || '默认数据库'}\nconst result = db.query(\`${q}\`);`;
        } else if (action.type === 'script' && action.script?.trim()) {
          effectivePreScript += `\n// [脚本] ${action.script.split('\n')[0]}\n${action.script}`;
        }
      }
    } catch { /* ignore invalid JSON */ }
  } else if (api.pre_db_query && api.pre_db_query.trim()) {
    const q = api.pre_db_query.trim().replace(/;$/, '');
    effectivePreScript = `const result = db.query(\`${q}\`);\n${effectivePreScript}`;
  }

  if (effectivePreScript.trim()) {
    const { executeScript } = await import('../db/scripts/pre-post.js');
    const preResult = await executeScript(effectivePreScript, {
      vars: { ...envContext, ...scriptVars },
      env: envContext,
      prevApi: undefined,
      dbConfigs: allDbConfigs,
      dbName: api.pre_db_name || undefined,
    });
    if (!preResult.success) {
      preError = `前置脚本错误: ${preResult.error}`;
    } else if (preResult.vars) {
      Object.assign(scriptVars, preResult.vars);
    }
  }

  // ── Step 2: Pre extraction (apply pre-extraction rules → merge into scriptVars) ──
  // ── Step 3: Pre assertions (validate pre-extracted values) ──
  let preAssertResults: import('../db/apis.js').AssertionResult[] = [];
  if (api.pre_assertions && !preError) {
    try {
      const preRules: AssertionRule[] = JSON.parse(api.pre_assertions);
      const allVars = { ...envContext, ...scriptVars };
      const { results, extracted } = evaluateAssertions(preRules, 0, {}, JSON.stringify(allVars));
      preAssertResults = results;
      // Merge extracted values into scriptVars so they can be used in HTTP request
      Object.assign(scriptVars, extracted);
    } catch { /* ignore */ }
  }

  // ── Step 4: HTTP Request (can use {{extracted_var}} from pre phase) ──
  let fullUrl = substitute(api.url);
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${api.protocol}://${fullUrl}`;
  }

  const reqHeaders: Record<string, string> = {};
  if (api.headers) {
    try { Object.assign(reqHeaders, JSON.parse(substitute(api.headers))); } catch { /* ignore */ }
  }
  if (api.body && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    const ct = api.content_type || 'json';
    if (ct === 'json') reqHeaders['Content-Type'] = 'application/json';
    else if (ct === 'form') reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (ct === 'xml') reqHeaders['Content-Type'] = 'application/xml';
    else reqHeaders['Content-Type'] = 'text/plain';
  }

  let statusCode: number | null = null;
  let respHeaders: string | null = null;
  let respBody: string | null = null;
  const requestHeadersStr = JSON.stringify(reqHeaders);
  const requestBodyStr = api.body || null;

  let mainStatusCode: number | null = null;
  let mainRespHeaders: Record<string, string> = {};
  let mainRespBody: string | null = null;

  try {
    const fetchOptions: RequestInit & { agent?: unknown } = {
      method: api.method,
      headers: reqHeaders,
      body: ['POST', 'PUT', 'PATCH'].includes(api.method) && api.body ? substitute(api.body) : undefined,
      signal: AbortSignal.timeout(envTimeout || 30000),
    };

    const urlObj = new URL(fullUrl);
    if (urlObj.protocol === 'https:' && (sslCert || sslKey)) {
      const { default: https } = await import('node:https');
      fetchOptions.agent = new https.Agent({ cert: sslCert, key: sslKey });
    }

    const response = await fetch(fullUrl, fetchOptions as Parameters<typeof fetch>[1]);
    const duration = Date.now() - start;

    statusCode = response.status;
    mainStatusCode = statusCode;
    const respHeadersObj = Object.fromEntries(response.headers.entries());
    mainRespHeaders = respHeadersObj;
    respHeaders = JSON.stringify(respHeadersObj);
    respBody = await response.text();
    mainRespBody = respBody;

    if (respBody.length > 1_000_000) {
      respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
      mainRespBody = respBody;
    }

    // ── Step 5: Main extraction (apply main-extraction rules → merge into scriptVars) ──
    // ── Step 6: Main assertions (validate HTTP response) ──
    let assertions: AssertionRule[] = [];
    if (api.assertions) { try { assertions = JSON.parse(api.assertions); } catch { /* ignore */ } }
    let mainResults: { rule: AssertionRule; passed: boolean; actual: string }[] = [];
    if (assertions.length > 0) {
      const { results, extracted } = evaluateAssertions(assertions, mainStatusCode, mainRespHeaders, mainRespBody || '');
      mainResults = results;
      Object.assign(scriptVars, extracted);
    }

    // ── Step 7: Post-script (legacy or new action format, can use {{main_extracted_var}}) ──
    let postError: string | null = null;
    let effectivePostScript = api.post_script || '';

    // Support new action format for post actions
    if (api.post_actions) {
      try {
        const actions = JSON.parse(api.post_actions) as Array<{ type: string; script?: string; dbName?: string; dbQuery?: string }>;
        for (const action of actions) {
          if (action.type === 'db' && action.dbQuery?.trim()) {
            const q = action.dbQuery.trim().replace(/;$/, '');
            effectivePostScript += `\n// [数据库查询] ${action.dbName || '默认数据库'}\nconst result = db.query(\`${q}\`);`;
          } else if (action.type === 'script' && action.script?.trim()) {
            effectivePostScript += `\n// [脚本] ${action.script.split('\n')[0]}\n${action.script}`;
          }
        }
      } catch { /* ignore invalid JSON */ }
    } else if (api.post_db_query && api.post_db_query.trim()) {
      const q = api.post_db_query.trim().replace(/;$/, '');
      effectivePostScript = `const result = db.query(\`${q}\`);\n${effectivePostScript}`;
    }
    if (effectivePostScript.trim() && !preError) {
      const { executeScript } = await import('../db/scripts/pre-post.js');
      const postResult = await executeScript(effectivePostScript, {
        vars: { ...envContext, ...scriptVars },
        env: envContext,
        prevApi: {
          status_code: statusCode,
          response_body: respBody || '',
          response_headers: respHeadersObj,
        },
        dbConfigs: allDbConfigs,
        dbName: api.post_db_name || undefined,
      });
      if (!postResult.success) {
        postError = `后置脚本错误: ${postResult.error}`;
      } else if (postResult.vars) {
        Object.assign(scriptVars, postResult.vars);
      }
    }

    // ── Step 8: Post extraction (apply post-extraction rules → merge into scriptVars) ──
    // ── Step 9: Post assertions (validate HTTP response + post-script context) ──
    let postAssertResults: import('../db/apis.js').AssertionResult[] = [];
    if (api.post_assertions && !postError) {
      try {
        const postRules: AssertionRule[] = JSON.parse(api.post_assertions);
        // Merge scriptVars into body for extraction: response_body + { vars: scriptVars }
        const postBody = mainRespBody
          ? `${mainRespBody}\n${JSON.stringify({ _vars: scriptVars })}`
          : JSON.stringify({ _vars: scriptVars });
        const { results, extracted } = evaluateAssertions(postRules, mainStatusCode, mainRespHeaders, postBody);
        postAssertResults = results;
        Object.assign(scriptVars, extracted);
      } catch { /* ignore */ }
    }

    // ── Step 10: Final assertions (all phases done, full context available) ──
    let finalAssertResults: import('../db/apis.js').AssertionResult[] = [];
    if (api.final_assertions) {
      try {
        const finalRules: AssertionRule[] = JSON.parse(api.final_assertions);
        // Include all accumulated scriptVars in body for extraction + assertion
        const finalBody = mainRespBody
          ? `${mainRespBody}\n${JSON.stringify({ _vars: scriptVars })}`
          : JSON.stringify({ _vars: scriptVars });
        const { results, extracted } = evaluateAssertions(finalRules, mainStatusCode, mainRespHeaders, finalBody);
        finalAssertResults = results;
        Object.assign(scriptVars, extracted);
      } catch { /* ignore */ }
    }

    const assertionResults = JSON.stringify({ main: mainResults, pre: preAssertResults, post: postAssertResults, final: finalAssertResults });

    const logId = createApiLog(api.id, {
      status_code: statusCode,
      request_headers: requestHeadersStr,
      request_body: requestBodyStr,
      response_headers: respHeaders,
      response_body: respBody,
      duration_ms: duration,
      executed_by: executedBy,
      assertion_results: assertionResults,
    });

    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: logId,
        api_id: api.id,
        status_code: statusCode,
        request_headers: requestHeadersStr,
        request_body: requestBodyStr,
        response_headers: respHeaders,
        response_body: respBody,
        duration_ms: duration,
        executed_by: executedBy,
        assertion_results: { main: mainResults, pre: preAssertResults, post: postAssertResults, final: finalAssertResults },
        script_error: preError || undefined,
      },
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    const logId = createApiLog(api.id, {
      status_code: 0,
      request_headers: requestHeadersStr,
      request_body: requestBodyStr,
      response_headers: null,
      response_body: JSON.stringify({ error: errorMsg }),
      duration_ms: duration,
      executed_by: executedBy,
      assertion_results: null,
    });

    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: logId,
        api_id: api.id,
        status_code: 0,
        request_headers: requestHeadersStr,
        request_body: requestBodyStr,
        response_headers: null,
        response_body: JSON.stringify({ error: errorMsg }),
        duration_ms: duration,
        executed_by: executedBy,
        assertion_results: { main: [], pre: [], post: [], final: [] },
        script_error: preError || undefined,
      },
    });
  }
});

// GET /api/apis/:id/logs
apiRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByApiId(api.id, limit);
  res.json({ code: 200, message: 'ok', data: logs });
});
