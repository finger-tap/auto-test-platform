import { findApiById, type AssertionRule } from '../db/apis.js';
import { evalBuiltin } from './builtins.js';

export interface ApiExecutionResult {
  api_id: number;
  status_code: number | null;
  request_headers: string;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number;
  error_message?: string;
}

// Apply substitution with builtin function support
function doSub(text: string, context: Record<string, string>): string {
  return evalBuiltin(text, context);
}

export interface ExecuteApiOptions {
  sslCert?: string;
  sslKey?: string;
  timeout?: number;
}

export async function executeApi(
  apiId: number,
  context: Record<string, string>,
  overrideHeaders?: string,
  overrideBody?: string,
  options?: ExecuteApiOptions
): Promise<ApiExecutionResult> {
  const api = findApiById(apiId);
  if (!api) throw new Error(`API ${apiId} not found`);

  const timeout = options?.timeout ?? 30000;

  // Build URL
  let fullUrl = doSub(api.url, context);
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${api.protocol}://${fullUrl}`;
  }

  // Build headers
  const reqHeaders: Record<string, string> = {};
  const headersSource = overrideHeaders || api.headers;
  if (headersSource) {
    try { Object.assign(reqHeaders, JSON.parse(doSub(headersSource, context))); } catch { /* ignore */ }
  }

  // Build body
  let reqBody: string | undefined;
  const bodySource = overrideBody || api.body;
  if (bodySource && ['POST', 'PUT', 'PATCH'].includes(api.method)) {
    reqBody = doSub(bodySource, context);
  }

  // Auto content-type
  if (reqBody && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    const ct = api.content_type || 'json';
    if (ct === 'json') reqHeaders['Content-Type'] = 'application/json';
    else if (ct === 'form') reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (ct === 'xml') reqHeaders['Content-Type'] = 'application/xml';
    else reqHeaders['Content-Type'] = 'text/plain';
  }

  const requestHeadersStr = JSON.stringify(reqHeaders);
  const start = Date.now();

  try {
    const fetchOptions: RequestInit & { agent?: unknown } = {
      method: api.method,
      headers: reqHeaders,
      body: reqBody,
      signal: AbortSignal.timeout(timeout),
    };

    // SSL client certificate support via https.Agent
    const urlObj = new URL(fullUrl);
    if (urlObj.protocol === 'https:' && (options?.sslCert || options?.sslKey)) {
      const { default: https } = await import('node:https');
      const agent = new https.Agent({
        cert: options.sslCert || undefined,
        key: options.sslKey || undefined,
      });
      fetchOptions.agent = agent;
    }

    const response = await fetch(fullUrl, fetchOptions as Parameters<typeof fetch>[1]);
    const duration = Date.now() - start;
    const statusCode = response.status;
    const respHeadersObj = Object.fromEntries(response.headers.entries());
    let respBody = await response.text();

    if (respBody.length > 1_000_000) {
      respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
    }

    return {
      api_id: apiId,
      status_code: statusCode,
      request_headers: requestHeadersStr,
      request_body: reqBody || null,
      response_headers: JSON.stringify(respHeadersObj),
      response_body: respBody,
      duration_ms: duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return {
      api_id: apiId,
      status_code: 0,
      request_headers: requestHeadersStr,
      request_body: reqBody || null,
      response_headers: null,
      response_body: null,
      duration_ms: duration,
      error_message: errorMsg,
    };
  }
}

// Extract value from response based on source and key
export function extractValue(
  result: ApiExecutionResult,
  source: 'status' | 'header' | 'body',
  key: string
): string {
  if (source === 'status') return String(result.status_code ?? '');
  if (source === 'header') {
    if (!result.response_headers) return '';
    try {
      const headers = JSON.parse(result.response_headers);
      const found = Object.entries(headers).find(([k]) => k.toLowerCase() === key.toLowerCase());
      return found ? String(found[1]) : '';
    } catch { return ''; }
  }
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
 * Extract value from raw body string (used by routes/apis.ts execute endpoint).
 * Supports multiple lookup strategies:
 * 1. Direct key lookup on parsed JSON
 * 2. vars.{key} lookup for pre/post context where vars are merged in body
 * 3. JSONPath-like traversal
 */
function extractFromBody(body: string, key: string): string {
  if (!key) return body;
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { return body; }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // Strategy 1: direct key lookup
    if (key in obj) return String(obj[key] ?? '');
    // Strategy 2: vars.{key} for pre/post script context
    if ('vars' in obj && typeof obj.vars === 'object') {
      const vars = obj.vars as Record<string, unknown>;
      if (key in vars) return String(vars[key] ?? '');
    }
    // Strategy 3: JSONPath-like traversal
    let val: unknown = parsed;
    for (const seg of key.split('.')) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[seg];
      else { val = undefined; break; }
    }
    return val !== undefined ? String(val) : '';
  }
  return body;
}

/**
 * Evaluate extraction + assertion rules in one pass.
 * Extraction rules (assert=false): extract value from source and merge into `extracted` map.
 * Assertion rules (assert=true): check value against expected, use extracted values if available.
 *
 * Returns results + all extracted key-value pairs so the caller can merge into scriptVars.
 */
export function evaluateAssertions(
  rules: AssertionRule[],
  statusCode: number | null,
  respHeaders: Record<string, string>,
  respBody: string
): { results: { rule: AssertionRule; passed: boolean; actual: string }[]; extracted: Record<string, string> } {
  // Phase 1: resolve all extraction rules and collect extracted values
  const extracted: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.assert === false && rule.key) {
      let actual = '';
      if (rule.source === 'status') {
        actual = String(statusCode ?? '');
      } else if (rule.source === 'header') {
        const hkey = rule.key.toLowerCase();
        const found = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === hkey);
        actual = found ? found[1] : '';
      } else {
        actual = extractFromBody(respBody, rule.key);
      }
      extracted[rule.key] = actual;
    }
  }

  // Phase 2: evaluate all rules (extractions pass through, assertions do actual checks)
  const results = rules.map((rule) => {
    let actual: string;
    if (rule.source === 'status') {
      actual = String(statusCode ?? '');
    } else if (rule.source === 'header') {
      const hkey = rule.key.toLowerCase();
      const found = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === hkey);
      actual = found ? found[1] : '';
    } else {
      // Extraction: use already-resolved value if key matches
      if (rule.assert === false && extracted[rule.key] !== undefined) {
        actual = extracted[rule.key];
      } else {
        actual = extractFromBody(respBody, rule.key);
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

  return { results, extracted };
}