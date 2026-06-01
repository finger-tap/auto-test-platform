/**
 * Mock Server Engine — intercepts HTTP requests and returns mocked responses.
 * Can be used standalone (pure mock) or as a proxy (forward + mock on match).
 *
 * Supports:
 * - Path pattern matching: exact, contains, wildcard (glob), regex
 * - Method matching: GET/POST/PUT/DELETE/PATCH or * (any)
 * - Condition matching: query params, headers, body fields
 * - Configurable response: status, headers, body, delay
 * - Hit tracking: count and last_hit timestamp
 */

import db from '../db/index.js';
import { incrementMockHit as incrementMockHitApi } from '../db/mocks-api.js';
import { incrementMockHit as incrementMockHitWeb } from '../db/mocks-web.js';
import { incrementMockHit as incrementMockHitPc } from '../db/mocks-pc.js';
import { incrementMockHit as incrementMockHitMobile } from '../db/mocks-mobile.js';

export interface MockEndpointRow {
  id: number;
  user_id: number;
  name: string;
  method: string;
  path_pattern: string;
  description: string | null;
  tags: string | null;
  status: string | null;
  response_status: number;
  response_headers: string;
  response_body: string;
  response_delay_ms: number;
  conditions: string;
  match_mode: 'exact' | 'contains' | 'regex' | 'wildcard';
  enabled: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

type MockSource = 'api' | 'web' | 'pc' | 'mobile';

const MOCK_INCREMENTERS: Record<MockSource, (id: number) => void> = {
  api: incrementMockHitApi,
  web: incrementMockHitWeb,
  pc: incrementMockHitPc,
  mobile: incrementMockHitMobile,
};

const MOCK_TABLES: Array<{ name: string; source: MockSource }> = [
  { name: 'mock_endpoints_api', source: 'api' },
  { name: 'mock_endpoints_web', source: 'web' },
  { name: 'mock_endpoints_pc', source: 'pc' },
  { name: 'mock_endpoints_mobile', source: 'mobile' },
];

function findMocksByUserId(userId: number): Array<MockEndpointRow & { _source: MockSource }> {
  const out: Array<MockEndpointRow & { _source: MockSource }> = [];
  for (const t of MOCK_TABLES) {
    const rows = db
      .prepare(`SELECT * FROM ${t.name} WHERE user_id = ? ORDER BY updated_at DESC`)
      .all(userId) as MockEndpointRow[];
    for (const r of rows) out.push({ ...r, _source: t.source });
  }
  return out;
}

export interface MockMatchResult {
  matched: boolean;
  mock?: MockEndpointRow;
  reason?: string;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  delay_ms: number;
  is_mock: true;
}

interface MockCondition {
  source: 'query' | 'header' | 'body';
  param: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'gt' | 'lt';
  value: string;
}

/**
 * Check if a request matches a mock endpoint.
 */
export function matchRequest(
  mock: MockEndpointRow,
  req: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string }
): MockMatchResult {
  // Check enabled
  if (!mock.enabled) {
    return { matched: false, reason: 'Mock disabled' };
  }

  // Check method
  if (mock.method !== '*' && mock.method !== req.method.toUpperCase()) {
    return { matched: false, reason: `Method mismatch: ${req.method} vs ${mock.method}` };
  }

  // Check path pattern
  if (!matchPath(req.path, mock.path_pattern, mock.match_mode as 'exact' | 'contains' | 'regex' | 'wildcard')) {
    return { matched: false, reason: `Path mismatch: ${req.path} vs ${mock.path_pattern}` };
  }

  // Check conditions
  if (mock.conditions) {
    try {
      const conditions: MockCondition[] = JSON.parse(mock.conditions);
      for (const cond of conditions) {
        if (!matchCondition(req, cond)) {
          return { matched: false, reason: `Condition failed: ${cond.source}.${cond.param} ${cond.operator} ${cond.value}` };
        }
      }
    } catch { /* ignore invalid conditions */ }
  }

  return { matched: true, mock };
}

/**
 * Match path against pattern.
 */
function matchPath(path: string, pattern: string, mode: 'exact' | 'contains' | 'regex' | 'wildcard'): boolean {
  const p = path.split('?')[0]; // strip query string

  switch (mode) {
    case 'exact':
      return p === pattern;
    case 'contains':
      return p.includes(pattern);
    case 'regex':
      try {
        const re = new RegExp(pattern);
        return re.test(p);
      } catch {
        return false;
      }
    case 'wildcard':
      // Convert glob pattern: /api/users/:id → /^\\/api\\/users\\/[^/]+$/
      return matchWildcard(p, pattern);
    default:
      return p === pattern;
  }
}

/**
 * Simple wildcard matching (converts :param → [^/]+, * → .*)
 */
function matchWildcard(path: string, pattern: string): boolean {
  // Escape regex special chars except : and *
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/:[^/]+/g, '[^/]+');

  try {
    return new RegExp(`^${regexPattern}$`).test(path);
  } catch {
    return false;
  }
}

/**
 * Match a condition against the request.
 */
function matchCondition(req: { query: Record<string, string>; headers: Record<string, string>; body: string }, cond: MockCondition): boolean {
  let actual = '';

  if (cond.source === 'query') {
    actual = req.query[cond.param] ?? '';
  } else if (cond.source === 'header') {
    actual = req.headers[cond.param.toLowerCase()] ?? '';
  } else if (cond.source === 'body') {
    try {
      const bodyObj = JSON.parse(req.body);
      actual = String(bodyObj[cond.param] ?? '');
    } catch {
      actual = '';
    }
  }

  switch (cond.operator) {
    case 'equals': return actual === cond.value;
    case 'not_equals': return actual !== cond.value;
    case 'contains': return actual.includes(cond.value);
    case 'not_contains': return !actual.includes(cond.value);
    case 'exists': return actual !== '';
    case 'not_exists': return actual === '';
    case 'gt': return parseFloat(actual) > parseFloat(cond.value);
    case 'lt': return parseFloat(actual) < parseFloat(cond.value);
    default: return false;
  }
}

/**
 * Execute a mock and return the response.
 */
export function executeMock(mock: MockEndpointRow & { _source?: MockSource }): MockResponse {
  // Increment hit counter on the correct per-type table
  const source: MockSource = (mock._source as MockSource) || 'api';
  MOCK_INCREMENTERS[source](mock.id);

  // Parse response config
  let headers: Record<string, string> = {};
  try { headers = JSON.parse(mock.response_headers || '{}'); } catch { /* ignore */ }

  const body = mock.response_body || '{}';
  const delay = mock.response_delay_ms || 0;

  return {
    status: mock.response_status || 200,
    headers,
    body,
    delay_ms: delay,
    is_mock: true,
  };
}

/**
 * Apply a delay (simulated latency).
 */
export async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find the first matching mock for a user.
 */
export function findMatchingMock(
  userId: number,
  req: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string }
): MockMatchResult {
  // Get all enabled mocks for this user
  // In production you'd index by path/method; here we do a simple linear scan
  // (acceptable for small mock sets, or add DB index on path_pattern + enabled)
  const mocks = findMocksByUserId(userId);
  for (const mock of mocks) {
    const result = matchRequest(mock, req);
    if (result.matched) return result;
  }
  return { matched: false, reason: 'No matching mock found' };
}