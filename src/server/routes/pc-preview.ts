// PC preview routes — start/stop desktop screenshot stream.
//
// POST /api/pc/preview/start   → { sessionId }
// POST /api/pc/preview/stop    → { ok }
// GET  /api/pc/preview/stream  → text/event-stream (SSE screenshot frames)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import {
  createSession,
  stopSession,
  hasSession,
  getSessionUserId,
  subscribe,
} from '../pc-preview/manager.js';

export const pcPreviewRoutes = Router();

// SSE uses ?token= query (EventSource can't set Authorization header)
function sseTokenQueryFallback(req: Request, res: Response, next: NextFunction): void {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(401).json({ code: 401, message: 'Authentication required: ?token= <jwt>' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ code: 401, message: 'Invalid or expired token' });
    return;
  }
  req.user = { userId: payload.userId, account: payload.account };
  next();
}

pcPreviewRoutes.post('/start', authMiddleware, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sessionId = createSession(userId);
  res.json({
    code: 200,
    message: 'ok',
    data: {
      sessionId,
      ssePath: `/api/pc/preview/stream?sessionId=${sessionId}`,
    },
  });
});

pcPreviewRoutes.post('/stop', authMiddleware, (req: Request, res: Response) => {
  const { sessionId } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ code: 400, message: 'sessionId is required' });
    return;
  }
  const ok = stopSession(sessionId);
  res.json({ code: 200, message: ok ? 'stopped' : 'session not found', data: { ok } });
});

pcPreviewRoutes.get('/stream', sseTokenQueryFallback, (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId) {
    res.status(400).json({ code: 400, message: 'sessionId is required' });
    return;
  }
  if (!hasSession(sessionId)) {
    res.status(404).json({ code: 404, message: 'session not found or already stopped' });
    return;
  }
  // Verify the session belongs to this user
  const sessionUserId = getSessionUserId(sessionId);
  if (sessionUserId !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'session belongs to another user' });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  console.log(`[pc-preview:route] SSE stream accept user=${req.user!.userId} sessionId=${sessionId}`);
  subscribe(sessionId, res);
});
