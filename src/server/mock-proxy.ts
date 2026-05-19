/**
 * Mock Proxy Middleware
 * Intercepts HTTP requests and matches them against user-defined Mock endpoints.
 * If a match is found, serves the mock response instead of forwarding the request.
 */
import type { Request, Response, NextFunction } from 'express';
import db from './db/index.js';
import { incrementMockHit } from './db/mocks.js';

interface MockConditions {
  param: string;
  operator: string;
  value: string;
}

function matchPath(pattern: string, urlPath: string): boolean {
  const regexStr = pattern
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\//g, '\\/');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(urlPath);
}

function matchMethod(mockMethod: string, reqMethod: string): boolean {
  return mockMethod === '*' || mockMethod === reqMethod;
}

function matchConditions(conditions: MockConditions[], req: Request): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
    let actualValue: string | undefined;
    const parts = cond.param.split('.');
    if (parts[0] === 'query') {
      actualValue = req.query[parts[1]] as string | undefined;
    } else if (parts[0] === 'body') {
      let obj: unknown = req.body;
      for (let i = 1; i < parts.length; i++) {
        if (typeof obj !== 'object' || obj === null) { actualValue = undefined; break; }
        obj = (obj as Record<string, unknown>)[parts[i]];
      }
      actualValue = typeof obj === 'string' ? obj : JSON.stringify(obj);
    } else if (parts[0] === 'header') {
      actualValue = req.headers[parts[1].toLowerCase()] as string | undefined;
    }
    let matched = false;
    switch (cond.operator) {
      case 'eq': matched = actualValue === cond.value; break;
      case 'ne': matched = actualValue !== cond.value; break;
      case 'gt': matched = Number(actualValue) > Number(cond.value); break;
      case 'lt': matched = Number(actualValue) < Number(cond.value); break;
      case 'contains': matched = (actualValue || '').includes(cond.value); break;
      case 'exists': matched = actualValue !== undefined && actualValue !== ''; break;
      case 'notExists': matched = actualValue === undefined || actualValue === ''; break;
      default: matched = true;
    }
    if (!matched) return false;
  }
  return true;
}

export function checkMock(req: Request, res: Response, next: NextFunction) {
  const urlPath = req.path;
  const reqMethod = req.method.toUpperCase();

  const mocks = db.prepare(
    'SELECT * FROM mock_endpoints WHERE enabled = 1 ORDER BY updated_at DESC'
  ).all() as Array<{
    id: number; user_id: number; method: string; path_pattern: string;
    response_status: number; response_headers: string; response_body: string;
    response_delay_ms: number; conditions: string; match_mode: string;
  }>;

  for (const mock of mocks) {
    if (!matchMethod(mock.method, reqMethod)) continue;
    if (!matchPath(mock.path_pattern, urlPath)) continue;

    let conditions: MockConditions[] = [];
    try { conditions = JSON.parse(mock.conditions || '[]'); } catch { conditions = []; }
    if (!matchConditions(conditions, req)) continue;

    const headers: Record<string, string> = {};
    try { Object.assign(headers, JSON.parse(mock.response_headers || '{}')); } catch { }
    res.set(headers);
    res.set('Access-Control-Allow-Origin', '*');
    if (reqMethod === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,*');
      return res.status(204).end();
    }

    const sendResponse = () => {
      incrementMockHit(mock.id);
      let body = mock.response_body || '{}';
      try { JSON.parse(body); } catch { body = JSON.stringify(body); }
      res.status(mock.response_status).send(body);
    };

    if (mock.response_delay_ms > 0) {
      setTimeout(sendResponse, mock.response_delay_ms);
    } else {
      sendResponse();
    }
    return;
  }

  next();
}