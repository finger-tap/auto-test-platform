import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { findApisByUserId, findApiById, createApi, updateApi, deleteApi, createApiLog, findLogsByApiId } from '../db/apis.js';

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
  const { name, method, url, protocol, headers, body, description, tags, status } = req.body;

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

  const id = createApi(req.user!.userId, { name: name.trim(), method, url: url.trim(), protocol, headers, body, description, tags, status });
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

  const { name, method, url, protocol, headers, body, description, tags, status } = req.body;
  if (method && !VALID_METHODS.includes(method)) {
    res.status(400).json({ code: 400, message: 'Invalid method' });
    return;
  }

  updateApi(api.id, { name, method, url, protocol, headers, body, description, tags, status });
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

  let fullUrl = api.url;
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${api.protocol}://${fullUrl}`;
  }

  const start = Date.now();
  let statusCode: number | null = null;
  let respHeaders: string | null = null;
  let respBody: string | null = null;

  try {
    const fetchOptions: RequestInit = {
      method: api.method,
      headers: api.headers ? JSON.parse(api.headers) : undefined,
      body: ['POST', 'PUT', 'PATCH'].includes(api.method) && api.body ? api.body : undefined,
      signal: AbortSignal.timeout(30000),
    };

    const response = await fetch(fullUrl, fetchOptions);
    const duration = Date.now() - start;

    statusCode = response.status;
    respHeaders = JSON.stringify(Object.fromEntries(response.headers.entries()));
    respBody = await response.text();

    // Truncate very large responses
    if (respBody.length > 1_000_000) {
      respBody = respBody.slice(0, 1_000_000) + '\n\n[Response truncated at 1MB]';
    }

    const logId = createApiLog(api.id, {
      status_code: statusCode,
      response_headers: respHeaders,
      response_body: respBody,
      duration_ms: duration,
    });

    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: logId,
        api_id: api.id,
        status_code: statusCode,
        response_headers: respHeaders,
        response_body: respBody,
        duration_ms: duration,
      },
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    const logId = createApiLog(api.id, {
      status_code: 0,
      response_headers: null,
      response_body: JSON.stringify({ error: errorMsg }),
      duration_ms: duration,
    });

    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: logId,
        api_id: api.id,
        status_code: 0,
        response_headers: null,
        response_body: JSON.stringify({ error: errorMsg }),
        duration_ms: duration,
      },
    });
  }
});

// GET /api/apis/:id/logs
apiRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const api = checkOwnership(req, res);
  if (!api) return;

  const logs = findLogsByApiId(api.id);
  res.json({ code: 200, message: 'ok', data: logs });
});
