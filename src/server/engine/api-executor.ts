import { findApiById, type AssertionRule, createApiExecution, createApiExecutionStep, updateApiExecution, type ApiExecutionRow, type ApiExecutionStepRow } from '../db/apis.js';
import { evalBuiltin } from './builtins.js';
import { executeScript } from '../db/scripts/pre-post.js';
import { generateBatchId } from '../utils/id.js';
import type { DbConfig } from '../db/environments.js';

export interface ApiExecutionResult {
  execution_id: number;
  api_id: number;
  status: 'success' | 'failed' | 'error';
  param_row_index: number | null;
  status_code: number | null;
  request_headers: Record<string, string>;
  request_body: string | null;
  response_headers: Record<string, string>;
  response_body: string | null;
  duration_ms: number;
  error_message: string | null;
  steps: ApiExecutionStep[];
  assertion_results: {
    pre: Array<{ rule: AssertionRule; passed: boolean; actual: string }>;
    main: Array<{ rule: AssertionRule; passed: boolean; actual: string }>;
    post: Array<{ rule: AssertionRule; passed: boolean; actual: string }>;
    final: Array<{ rule: AssertionRule; passed: boolean; actual: string }>;
  };
}

export interface ApiExecutionStep {
  step_order: number;
  log_type: 'start' | 'pre_action' | 'main_action' | 'post_action' | 'final_check' | 'error' | 'end';
  step_name: string;
  log_text: string;
  log_data: Record<string, unknown>;
  created_at: string;
}

export interface ExecuteApiOptions {
  sslCert?: string;
  sslKey?: string;
  timeout?: number;
  paramConfig?: ApiParamConfig | null;
  scenarioExecutionId?: number;
  scenarioId?: number;
  nodeId?: string;
  executedBy?: string;
  dbConfigs?: Record<string, DbConfig> | null;
  /** Scenario-level param row index (passed from scenario execution loop) */
  scenarioParamRowIndex?: number | null;
  /** Scenario-level batch ID — all API executions in same scenario run share this batch_id */
  scenarioBatchId?: number;
}

export interface ApiParamConfig {
  enabled: boolean;
  source: 'csv' | 'manual';
  headers: string[];
  rows: string[][];
  enabledRows?: boolean[];
}

// Apply substitution with builtin function support
function doSub(text: string, context: Record<string, string>): string {
  return evalBuiltin(text, context);
}

// Extract value from response based on source and key
export function extractValue(
  result: { response_headers: string | null | Record<string, string>; response_body: string | null; status_code: number | null },
  source: 'status' | 'header' | 'body' | 'vars' | 'result' | 'row_count',
  key: string,
  vars?: Record<string, string>,
  dbResult?: unknown[]
): string {
  if (source === 'status') return String(result.status_code ?? '');
  if (source === 'header') {
    const headers = typeof result.response_headers === 'string'
      ? JSON.parse(result.response_headers || '{}')
      : result.response_headers || {};
    const found = Object.entries(headers).find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found ? String(found[1]) : '';
  }
  if (source === 'vars' && vars) return vars[key] || '';
  if (source === 'row_count' && dbResult) return String(dbResult.length);
  if (source === 'result' && dbResult) return extractFromResult(dbResult, key);
  if (!result.response_body) return '';
  try {
    const body = JSON.parse(result.response_body);
    let val: unknown = body;
    for (const seg of key.split('.')) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[seg];
      else return '';
    }
    return val !== undefined ? String(val) : '';
  } catch { return ''; }
}

/**
 * Evaluate extraction + assertion rules.
 */
export function evaluateAssertions(
  rules: AssertionRule[],
  statusCode: number | null,
  respHeaders: Record<string, string>,
  respBody: string,
  extracted: Record<string, string> = {}
): { results: Array<{ rule: AssertionRule; passed: boolean; actual: string }>; extracted: Record<string, string> } {
  const allExtracted = { ...extracted };

  // Phase 1: resolve all extraction rules
  for (const rule of rules) {
    if (rule.assert === false && rule.key) {
      let actual = '';
      if (rule.source === 'status') {
        actual = String(statusCode ?? '');
      } else if (rule.source === 'header') {
        const hkey = rule.key.toLowerCase();
        const found = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === hkey);
        actual = found ? found[1] : '';
      } else if (rule.source === 'vars') {
        actual = (rule.key in allExtracted ? allExtracted[rule.key] : '');
      } else {
        actual = extractValue({ response_headers: JSON.stringify(respHeaders), response_body: respBody, status_code: statusCode }, rule.source as 'body', rule.key);
      }
      allExtracted[rule.key] = actual;
    }
  }

  // Phase 2: evaluate all rules
  const results = rules.map((rule) => {
    let actual: string;
    if (rule.source === 'status') {
      actual = String(statusCode ?? '');
    } else if (rule.source === 'header') {
      const hkey = rule.key.toLowerCase();
      const found = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === hkey);
      actual = found ? found[1] : '';
    } else if (rule.source === 'vars') {
      actual = allExtracted[rule.key] || '';
    } else {
      if (rule.assert === false && allExtracted[rule.key] !== undefined) {
        actual = allExtracted[rule.key];
      } else {
        actual = extractValue({ response_headers: JSON.stringify(respHeaders), response_body: respBody, status_code: statusCode }, rule.source as 'body', rule.key);
      }
    }

    if (rule.assert === false) return { rule, passed: true, actual };

    let passed = false;
    switch (rule.operator) {
      case 'equals': passed = actual === rule.expected; break;
      case 'not_equals': passed = actual !== rule.expected; break;
      case 'contains': passed = actual.includes(rule.expected); break;
      case 'not_contains': passed = !actual.includes(rule.expected); break;
      case 'less_than': passed = Number(actual) < Number(rule.expected); break;
      case 'greater_than': passed = Number(actual) > Number(rule.expected); break;
      case 'exists': passed = actual !== '' && actual !== 'undefined'; break;
      case 'not_exists': passed = actual === '' || actual === 'undefined'; break;
    }
    return { rule, passed, actual };
  });

  return { results, extracted: allExtracted };
}

/**
 * Evaluate extraction + assertion rules for pre/post actions (script or db).
 * Supports: vars (script variables), result (query result array), row_count (result row count).
 */
export function evaluateActionRules(
  rules: AssertionRule[],
  scriptVars: Record<string, string>,
  dbResult: unknown[]
): { results: Array<{ rule: AssertionRule; passed: boolean; actual: string }>; extracted: Record<string, string> } {
  const allExtracted: Record<string, string> = { ...scriptVars };

  // Phase 1: resolve all extraction rules
  for (const rule of rules) {
    if (rule.assert === false && rule.key) {
      let actual = '';
      if (rule.source === 'vars') {
        actual = scriptVars[rule.key] || '';
      } else if (rule.source === 'result') {
        actual = extractFromResult(dbResult, rule.key);
      } else if (rule.source === 'row_count') {
        actual = String(dbResult.length);
      }
      allExtracted[rule.key] = actual;
    }
  }

  // Phase 2: evaluate all rules
  const results = rules.map((rule) => {
    let actual: string;
    if (rule.source === 'vars') {
      actual = scriptVars[rule.key] || '';
    } else if (rule.source === 'result') {
      actual = extractFromResult(dbResult, rule.key);
    } else if (rule.source === 'row_count') {
      actual = String(dbResult.length);
    } else {
      actual = allExtracted[rule.key] || '';
    }

    if (rule.assert === false) return { rule, passed: true, actual };

    let passed = false;
    switch (rule.operator) {
      case 'equals': passed = actual === rule.expected; break;
      case 'not_equals': passed = actual !== rule.expected; break;
      case 'contains': passed = actual.includes(rule.expected); break;
      case 'not_contains': passed = !actual.includes(rule.expected); break;
      case 'less_than': passed = Number(actual) < Number(rule.expected); break;
      case 'greater_than': passed = Number(actual) > Number(rule.expected); break;
      case 'exists': passed = actual !== '' && actual !== 'undefined'; break;
      case 'not_exists': passed = actual === '' || actual === 'undefined'; break;
    }
    return { rule, passed, actual };
  });

  return { results, extracted: allExtracted };
}

/**
 * Extract value from db query result using dot notation path.
 * Result is JSON array of rows.
 */
function extractFromResult(result: unknown[], key: string): string {
  if (!result || result.length === 0) return '';
  try {
    let val: unknown = result;
    for (const seg of key.split('.')) {
      const idx = parseInt(seg, 10);
      if (Array.isArray(val)) {
        val = val[idx];
      } else if (val && typeof val === 'object') {
        val = (val as Record<string, unknown>)[seg];
      } else {
        return '';
      }
    }
    return val !== undefined ? String(val) : '';
  } catch { return ''; }
}

/**
 * Execute an API with full step-by-step logging.
 * Returns array of ApiExecutionResult (one per param row if parametrized).
 */
export async function executeApi(
  apiId: number,
  context: Record<string, string>,
  overrideHeaders?: string,
  overrideBody?: string,
  options?: ExecuteApiOptions
): Promise<ApiExecutionResult[]> {
  const api = findApiById(apiId);
  if (!api) throw new Error(`API ${apiId} not found`);

  const timeout = options?.timeout ?? 30000;
  const paramConfig = options?.paramConfig ?? null;
  const executedBy = options?.executedBy ?? 'system';

  // Determine param rows
  const allParamRows = paramConfig?.rows?.length ? paramConfig.rows : [];
  const enabledRows = paramConfig?.enabledRows;
  const paramRows = (paramConfig?.enabled && allParamRows.length > 0 && enabledRows)
    ? allParamRows.filter((_, i) => enabledRows[i] !== false)
    : (allParamRows.length > 0 ? allParamRows : [null]);

  const results: ApiExecutionResult[] = [];
  // Generate batch_id once for this execution group
  // If scenarioBatchId is provided, use it directly; otherwise generate a unique batch_id
  const batchId = options.scenarioBatchId ?? generateBatchId();

  for (let rowIdx = 0; rowIdx < paramRows.length; rowIdx++) {
    const paramRow = paramRows[rowIdx];
    const startedAt = new Date().toISOString();
    const stepOrder = { current: 0 };

    // Build param context
    const paramContext: Record<string, string> = { ...context };
    if (paramRow && paramConfig?.headers) {
      paramConfig.headers.forEach((h, i) => {
        if (paramRow[i] !== undefined) paramContext[h] = paramRow[i];
      });
    }

    // Create api_execution record
    // Use scenarioParamRowIndex if provided (from scenario-level param), otherwise use rowIdx
    const effectiveRowIdx = options.scenarioParamRowIndex !== undefined ? options.scenarioParamRowIndex : (paramRow !== null ? rowIdx : -1);
    const executionId = createApiExecution({
      api_id: apiId,
      scenario_id: options?.scenarioId ?? null,
      node_id: options?.nodeId ?? null,
      param_row_index: effectiveRowIdx,
      status: 'running',
      trigger_type: 'manual',
      executed_by: executedBy,
      started_at: startedAt,
      finished_at: startedAt,
      batch_id: batchId,  // All rows in this execution group share same batch_id
    });

    const addStep = (logType: ApiExecutionStep['log_type'], stepName: string, logText: string, logData: Record<string, unknown> = {}) => {
      stepOrder.current++;
      try {
        createApiExecutionStep({
          api_execution_id: executionId,
          step_order: stepOrder.current,
          log_type: logType,
          step_name: stepName,
          log_text: logText,
          log_data: logData,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        // Don't let a logging failure abort the actual API execution flow.
        console.error('[api-executor] failed to persist step', { executionId, logType, stepName, err });
      }
    };

    // Helper to build URL
    const buildUrl = (ctx: Record<string, string>) => {
      let fullUrl = doSub(api.url, ctx);
      if (!/^https?:\/\//i.test(fullUrl)) {
        fullUrl = `${api.protocol}://${fullUrl}`;
      }
      return fullUrl;
    };

    // Helper to build headers
    const buildHeaders = (ctx: Record<string, string>) => {
      const reqHeaders: Record<string, string> = {};
      const headersSource = overrideHeaders || api.headers;
      if (headersSource) {
        try { Object.assign(reqHeaders, JSON.parse(doSub(headersSource, ctx))); } catch { /* ignore */ }
      }
      return reqHeaders;
    };

    // Helper to build body
    const buildBody = (ctx: Record<string, string>) => {
      if (!api.body || !['POST', 'PUT', 'PATCH'].includes(api.method)) return undefined;
      return doSub(api.body, ctx);
    };

    let status: ApiExecutionResult['status'] = 'success';
    let statusCode: number | null = null;
    let respHeaders: Record<string, string> = {};
    let respBody: string | null = null;
    let errorMessage: string | null = null;
    let requestHeadersStr = '';
    let requestBodyStr: string | null = null;
    let reqHeaders: Record<string, string> = {};
    const allExtracted: Record<string, string> = {};
    let envDbConfigs: Record<string, DbConfig> | null = options?.dbConfigs ?? null;
    let totalPassed = 0;
    let totalFailed = 0;

    const preAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
    const mainAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
    const postAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
    const finalAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];

    try {
      // Step: start
      addStep('start', '开始', `开始执行API: ${api.name}`, { api_id: apiId, api_name: api.name });

      // Pre-actions (pre_script + pre_db_query + pre_actions)
      if (api.pre_script || api.pre_db_query || api.pre_actions) {
        const preActionDetails: Array<{ type: string; content: string; dbName?: string; name?: string; rules?: AssertionRule[]; alwaysRun?: boolean }> = [];

        if (api.pre_actions) {
          try {
            const actions = JSON.parse(api.pre_actions) as Array<{ id: string; name?: string; type: string; script?: string; dbName?: string; dbQuery?: string; rules?: AssertionRule[]; alwaysRun?: boolean }>;
            for (const action of actions) {
              if (action.type === 'db' && action.dbQuery?.trim()) {
                preActionDetails.push({ type: 'db', content: action.dbQuery.trim(), dbName: action.dbName || '', name: action.name, rules: action.rules, alwaysRun: action.alwaysRun });
              } else if (action.type === 'script' && action.script?.trim()) {
                preActionDetails.push({ type: 'script', content: action.script.trim(), name: action.name, rules: action.rules, alwaysRun: action.alwaysRun });
              }
            }
          } catch { /* ignore */ }
        } else {
          if (api.pre_db_query?.trim()) {
            preActionDetails.push({ type: 'db', content: api.pre_db_query.trim(), dbName: api.pre_db_name || '' });
          }
        }

        if (api.pre_script?.trim()) {
          preActionDetails.push({ type: 'script', content: api.pre_script.trim() });
        }

        if (preActionDetails.length > 0) {
          addStep('pre_action', '前置动作', `执行前置动作: ${preActionDetails.length} 项`, { actions: preActionDetails });

          for (let i = 0; i < preActionDetails.length; i++) {
            const action = preActionDetails[i];
            const actionName = action.name || (action.type === 'db' ? `数据库查询${i + 1}` : `脚本动作${i + 1}`);

            // Execute the action and get result for rule evaluation
            let dbResult: unknown[] = [];
            let scriptResult: { success: boolean; vars?: Record<string, string> } | null = null;

            if (action.type === 'db') {
              // Execute DB query
              try {
                // @ts-ignore - db-pool.js module resolution
                const { getPool } = await import('../db-pool.js');
                const dbName = action.dbName || (envDbConfigs ? Object.keys(envDbConfigs)[0] : '');
                if (dbName && envDbConfigs && envDbConfigs[dbName]) {
                  const pool = await getPool(0, dbName, envDbConfigs[dbName]);
                  dbResult = await pool.query(action.content, []) as unknown[];
                }
              } catch (dbErr) {
                dbResult = [];
              }
            } else {
              // Execute script
              try {
                scriptResult = await executeScript(action.content, {
                  vars: paramContext,
                  env: context,
                  dbConfigs: envDbConfigs,
                });
                if (scriptResult.success && scriptResult.vars) {
                  Object.assign(paramContext, scriptResult.vars);
                  Object.assign(allExtracted, scriptResult.vars);
                }
              } catch (scriptErr) {
                scriptResult = { success: false };
              }
            }

            // Evaluate action rules
            const actionAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
            if (action.rules && action.rules.length > 0) {
              const { results: ruleResults, extracted } = evaluateActionRules(
                action.rules,
                paramContext,
                dbResult
              );
              actionAssertResults.push(...ruleResults);
              Object.assign(allExtracted, extracted);
            }

            if (action.type === 'db') {
              addStep('pre_action', actionName, `DB: ${action.dbName || 'default'}`, {
                db_name: action.dbName,
                query: action.content,
                rules: action.rules,
                assertion_results: actionAssertResults,
              });
            } else {
              addStep('pre_action', actionName, action.content.slice(0, 100) + (action.content.length > 100 ? '...' : ''), {
                script: action.content,
                script_success: scriptResult?.success ?? false,
                rules: action.rules,
                assertion_results: actionAssertResults,
              });
            }
          }
        }
      }

      // Main action: HTTP request
      const fullUrl = buildUrl(paramContext);
      const reqHeaders = buildHeaders(paramContext);
      const reqBody = buildBody(paramContext);

      // Auto content-type
      if (reqBody && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) {
        const ct = api.content_type || 'json';
        if (ct === 'json') reqHeaders['Content-Type'] = 'application/json';
        else if (ct === 'form') reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        else if (ct === 'xml') reqHeaders['Content-Type'] = 'application/xml';
        else reqHeaders['Content-Type'] = 'text/plain';
      }

      const requestHeadersStr = JSON.stringify(reqHeaders);
      const requestBodyStr = reqBody || null;
      const requestStart = Date.now();

      addStep('main_action', '主体请求', `${api.method} ${fullUrl}`, {
        method: api.method,
        url: fullUrl,
        url_original: api.url,
        request_headers: reqHeaders,
        request_body: reqBody,
      });

      try {
        const fetchOptions: RequestInit & { agent?: unknown } = {
          method: api.method,
          headers: reqHeaders,
          body: reqBody,
          signal: AbortSignal.timeout(timeout),
        };

        // SSL client certificate support
        const urlObj = new URL(fullUrl);
        if (urlObj.protocol === 'https:' && (options?.sslCert || options?.sslKey)) {
          const { default: https } = await import('node:https');
          fetchOptions.agent = new https.Agent({ cert: options.sslCert, key: options.sslKey });
        }

        const response = await fetch(fullUrl, fetchOptions as Parameters<typeof fetch>[1]);
        const requestDuration = Date.now() - requestStart;

        statusCode = response.status;
        const respHeadersObj = Object.fromEntries(response.headers.entries());
        respHeaders = respHeadersObj;
        respBody = await response.text();
        if (respBody.length > 1_000_000) {
          respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
        }

        addStep('main_action', '主体响应', `响应: ${statusCode} (${requestDuration}ms)`, {
          status_code: statusCode,
          response_headers: respHeadersObj,
          response_body: respBody,
          duration_ms: requestDuration,
        });
      } catch (err) {
        const requestDuration = Date.now() - requestStart;
        errorMessage = err instanceof Error ? err.message : 'Unknown error';
        status = 'error';
        addStep('error', '请求错误', `请求失败: ${errorMessage}`, { error: errorMessage, duration_ms: requestDuration });
      }

      // Main assertions
      if (api.assertions && status !== 'error') {
        try {
          const mainRules: AssertionRule[] = JSON.parse(api.assertions);
          const { results: mainResults, extracted } = evaluateAssertions(mainRules, statusCode, respHeaders, respBody || '', allExtracted);
          mainAssertResults.push(...mainResults);
          Object.assign(allExtracted, extracted);

          const passed = mainResults.filter(r => r.rule.assert !== false && r.passed).length;
          const failed = mainResults.filter(r => r.rule.assert !== false && !r.passed).length;
          totalPassed += passed;
          totalFailed += failed;
          addStep('main_action', '主体断言', `主体断言: ${passed} 通过, ${failed} 失败`, { assertions: mainResults });

          if (failed > 0) status = 'failed';
        } catch { /* ignore */ }
      }

      // Post-actions
      if (api.post_script || api.post_db_query || api.post_actions) {
        const postActionDetails: Array<{ type: string; content: string; dbName?: string; name?: string; rules?: AssertionRule[]; alwaysRun?: boolean }> = [];

        if (api.post_actions) {
          try {
            const actions = JSON.parse(api.post_actions) as Array<{ id: string; name?: string; type: string; script?: string; dbName?: string; dbQuery?: string; rules?: AssertionRule[]; alwaysRun?: boolean }>;
            for (const action of actions) {
              if (action.type === 'db' && action.dbQuery?.trim()) {
                postActionDetails.push({ type: 'db', content: action.dbQuery.trim(), dbName: action.dbName || '', name: action.name, rules: action.rules, alwaysRun: action.alwaysRun });
              } else if (action.type === 'script' && action.script?.trim()) {
                postActionDetails.push({ type: 'script', content: action.script.trim(), name: action.name, rules: action.rules, alwaysRun: action.alwaysRun });
              }
            }
          } catch { /* ignore */ }
        } else {
          if (api.post_db_query?.trim()) {
            postActionDetails.push({ type: 'db', content: api.post_db_query.trim(), dbName: api.post_db_name || '' });
          }
        }

        if (api.post_script?.trim()) {
          postActionDetails.push({ type: 'script', content: api.post_script.trim() });
        }

        if (postActionDetails.length > 0) {
          addStep('post_action', '后置动作', `执行后置动作: ${postActionDetails.length} 项`, { actions: postActionDetails });

          for (let i = 0; i < postActionDetails.length; i++) {
            const action = postActionDetails[i];
            const actionName = action.name || (action.type === 'db' ? `数据库查询${i + 1}` : `脚本动作${i + 1}`);

            // Skip if main action failed and this action doesn't want to always run
            if (status === 'error' && !action.alwaysRun) continue;

            // Execute the action and get result for rule evaluation
            let dbResult: unknown[] = [];
            let scriptResult: { success: boolean; vars?: Record<string, string> } | null = null;

            if (action.type === 'db') {
              // Execute DB query
              try {
                // @ts-ignore - db-pool.js module resolution
                const { getPool } = await import('../db-pool.js');
                const dbName = action.dbName || (envDbConfigs ? Object.keys(envDbConfigs)[0] : '');
                if (dbName && envDbConfigs && envDbConfigs[dbName]) {
                  const pool = await getPool(0, dbName, envDbConfigs[dbName]);
                  dbResult = await pool.query(action.content, []) as unknown[];
                }
              } catch (dbErr) {
                dbResult = [];
              }
            } else {
              // Execute script
              try {
                scriptResult = await executeScript(action.content, {
                  vars: paramContext,
                  env: context,
                  dbConfigs: envDbConfigs,
                });
                if (scriptResult.success && scriptResult.vars) {
                  Object.assign(paramContext, scriptResult.vars);
                  Object.assign(allExtracted, scriptResult.vars);
                }
              } catch (scriptErr) {
                scriptResult = { success: false };
              }
            }

            // Evaluate action rules
            const actionAssertResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
            if (action.rules && action.rules.length > 0) {
              const { results: ruleResults, extracted } = evaluateActionRules(
                action.rules,
                paramContext,
                dbResult
              );
              actionAssertResults.push(...ruleResults);
              Object.assign(allExtracted, extracted);
            }

            if (action.type === 'db') {
              addStep('post_action', actionName, `DB: ${action.dbName || 'default'}`, {
                db_name: action.dbName,
                query: action.content,
                rules: action.rules,
                assertion_results: actionAssertResults,
              });
            } else {
              addStep('post_action', actionName, action.content.slice(0, 100) + (action.content.length > 100 ? '...' : ''), {
                script: action.content,
                script_success: scriptResult?.success ?? false,
                rules: action.rules,
                assertion_results: actionAssertResults,
              });
            }
          }
        }
      }

      // Final summary step before end — captures overall assertion outcome
      addStep('final_check', '最终检查', `最终断言: ${totalPassed} 通过, ${totalFailed} 失败`, {
        passed: totalPassed,
        failed: totalFailed,
        status,
      });

      addStep('end', '完成', `执行${status === 'success' ? '成功' : status === 'failed' ? '失败' : '错误'}`, {
        status,
        duration_ms: Date.now() - new Date(startedAt).getTime(),
      });

    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      addStep('error', '错误', `执行异常: ${errorMessage}`, { error: errorMessage });
    }

    // Update execution record
    updateApiExecution(executionId, {
      status,
      request_headers: requestHeadersStr,
      request_body: requestBodyStr,
      response_headers: respBody ? JSON.stringify(respHeaders) : null,
      response_body: respBody,
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    });

    // Fetch steps for response
    const steps: ApiExecutionStep[] = [];
    // Build steps from what we logged
    steps.push({
      step_order: 1,
      log_type: 'start',
      step_name: '开始',
      log_text: `开始执行API: ${api.name}`,
      log_data: { api_id: apiId, api_name: api.name },
      created_at: startedAt,
    });

    results.push({
      execution_id: executionId,
      api_id: apiId,
      status,
      param_row_index: effectiveRowIdx,
      status_code: statusCode,
      request_headers: reqHeaders,
      request_body: requestBodyStr,
      response_headers: respHeaders,
      response_body: respBody,
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      error_message: errorMessage,
      steps,
      assertion_results: {
        pre: preAssertResults,
        main: mainAssertResults,
        post: postAssertResults,
        final: finalAssertResults,
      },
    });
  }

  return results;
}