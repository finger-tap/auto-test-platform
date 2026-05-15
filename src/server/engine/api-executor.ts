import { findApiById, type AssertionRule } from '../db/apis.js';

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

function substituteVars(text: string, context: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, varName) => {
    return context[varName] !== undefined ? context[varName] : match;
  });
}

export async function executeApi(
  apiId: number,
  context: Record<string, string>,
  overrideHeaders?: string,
  overrideBody?: string
): Promise<ApiExecutionResult> {
  const api = findApiById(apiId);
  if (!api) {
    throw new Error(`API ${apiId} not found`);
  }

  // Build URL with variable substitution
  let fullUrl = substituteVars(api.url, context);
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${api.protocol}://${fullUrl}`;
  }

  // Build request headers
  const reqHeaders: Record<string, string> = {};
  const headersSource = overrideHeaders || api.headers;
  if (headersSource) {
    try {
      const parsed = JSON.parse(substituteVars(headersSource, context));
      Object.assign(reqHeaders, parsed);
    } catch { /* ignore */ }
  }

  // Build request body
  let reqBody: string | undefined;
  const bodySource = overrideBody || api.body;
  if (bodySource && ['POST', 'PUT', 'PATCH'].includes(api.method)) {
    reqBody = substituteVars(bodySource, context);
  }

  // Auto set content-type
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
    const response = await fetch(fullUrl, {
      method: api.method,
      headers: reqHeaders,
      body: reqBody,
      signal: AbortSignal.timeout(30000),
    });

    const duration = Date.now() - start;
    const statusCode = response.status;
    const respHeadersObj = Object.fromEntries(response.headers.entries());
    const respHeaders = JSON.stringify(respHeadersObj);
    let respBody = await response.text();

    if (respBody.length > 1_000_000) {
      respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
    }

    return {
      api_id: apiId,
      status_code: statusCode,
      request_headers: requestHeadersStr,
      request_body: reqBody || null,
      response_headers: respHeaders,
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
  if (source === 'status') {
    return String(result.status_code ?? '');
  }

  if (source === 'header') {
    if (!result.response_headers) return '';
    try {
      const headers = JSON.parse(result.response_headers);
      const found = Object.entries(headers).find(([k]) => k.toLowerCase() === key.toLowerCase());
      return found ? String(found[1]) : '';
    } catch {
      return '';
    }
  }

  // body
  if (!result.response_body) return '';
  try {
    const body = JSON.parse(result.response_body);
    let val: unknown = body;
    for (const seg of key.split('.')) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[seg];
      else return '';
    }
    return val !== undefined ? String(val) : '';
  } catch {
    return '';
  }
}

// Evaluate assertion rules against an API execution result
export function evaluateAssertions(
  rules: AssertionRule[],
  statusCode: number | null,
  respHeaders: Record<string, string>,
  respBody: string
): { rule: AssertionRule; passed: boolean; actual: string }[] {
  let parsedBody: unknown = null;
  try { parsedBody = JSON.parse(respBody); } catch { /* not JSON */ }

  return rules.map((rule) => {
    let actual: string;

    if (rule.source === 'status') {
      actual = String(statusCode ?? '');
    } else if (rule.source === 'header') {
      const key = rule.key.toLowerCase();
      const found = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === key);
      actual = found ? found[1] : '';
    } else {
      // body — support dot-path like "data.user.name"
      actual = respBody;
      if (parsedBody && rule.key) {
        let val: unknown = parsedBody;
        for (const seg of rule.key.split('.')) {
          if (val && typeof val === 'object') val = (val as Record<string, unknown>)[seg];
          else { val = undefined; break; }
        }
        actual = val !== undefined ? String(val) : '';
      }
    }

    // Extraction-only: skip assertion check
    if (rule.assert === false) {
      return { rule, passed: true, actual };
    }

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
}
