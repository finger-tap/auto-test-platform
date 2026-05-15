import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { findApisByUserId, findApiById, createApi, updateApi, deleteApi, createApiLog, findLogsByApiId } from '../db/apis.js';
import type { AssertionRule } from '../db/apis.js';
import { evaluateAssertions } from '../engine/api-executor.js';
import { findUserById } from '../db/users.js';

export const apiRoutes = Router();
apiRoutes.use(authMiddleware);

const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// GET /api/apis
apiRoutes.get('/', (req: Request, res: Response) => {
  const apis = findApisByUserId(req.user!.userId);
  res.json({ code: 200, message: 'ok', data: apis });
});

// POST /api/apis
apiRoutes.post('/', (req: Request, res: Response) => {
  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions } = req.body;

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

  const id = createApi(req.user!.userId, { name: name.trim(), method, url: url.trim(), protocol, headers, body, description, tags, status, content_type, assertions });
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

  const { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions } = req.body;
  if (method && !VALID_METHODS.includes(method)) {
    res.status(400).json({ code: 400, message: 'Invalid method' });
    return;
  }

  updateApi(api.id, { name, method, url, protocol, headers, body, description, tags, status, content_type, assertions });
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

  if (api.protocol === 'ws') {
    res.status(400).json({ code: 400, message: 'WebSocket execution is not yet supported' });
    return;
  }

  // Get executor info
  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  let fullUrl = api.url;
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${api.protocol}://${fullUrl}`;
  }

  // Build request headers with content-type awareness
  const reqHeaders: Record<string, string> = {};
  if (api.headers) {
    try {
      Object.assign(reqHeaders, JSON.parse(api.headers));
    } catch { /* ignore */ }
  }
  // Auto set content-type if not already set and body exists
  if (api.body && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    const ct = api.content_type || 'json';
    if (ct === 'json') reqHeaders['Content-Type'] = 'application/json';
    else if (ct === 'form') reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (ct === 'xml') reqHeaders['Content-Type'] = 'application/xml';
    else reqHeaders['Content-Type'] = 'text/plain';
  }

  const start = Date.now();
  let statusCode: number | null = null;
  let respHeadersObj: Record<string, string> = {};
  let respHeaders: string | null = null;
  let respBody: string | null = null;
  let assertionResults: string | null = null;

  // Store request info for logging
  const requestHeadersStr = JSON.stringify(reqHeaders);
  const requestBodyStr = api.body || null;

  try {
    const fetchOptions: RequestInit = {
      method: api.method,
      headers: reqHeaders,
      body: ['POST', 'PUT', 'PATCH'].includes(api.method) && api.body ? api.body : undefined,
      signal: AbortSignal.timeout(30000),
    };

    const response = await fetch(fullUrl, fetchOptions);
    const duration = Date.now() - start;

    statusCode = response.status;
    respHeadersObj = Object.fromEntries(response.headers.entries());
    respHeaders = JSON.stringify(respHeadersObj);
    respBody = await response.text();

    if (respBody.length > 1_000_000) {
      respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
    }

    // Evaluate assertions
    let assertions: AssertionRule[] = [];
    if (api.assertions) {
      try { assertions = JSON.parse(api.assertions); } catch { /* ignore */ }
    }
    const aResults = assertions.length > 0
      ? evaluateAssertions(assertions, statusCode, respHeadersObj, respBody)
      : [];
    assertionResults = aResults.length > 0 ? JSON.stringify(aResults) : null;

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
        assertion_results: aResults,
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
        assertion_results: [],
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
