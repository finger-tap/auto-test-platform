// 2026-06-08: 移动端预览路由 — 启动 / 停止 SSE 帧流 / scrcpy WebSocket
//
// POST /api/mobile/preview/start    body: { deviceId, kind, caseExecutionId?, serial? }
//                                   → { sessionId, ssePath|wsPath, kind, device }
// POST /api/mobile/preview/stop     body: { sessionId }
//                                   → { ok: true }
// GET  /api/mobile/preview/stream?sessionId=xxx
//                                   → text/event-stream 帧流(screenshot / mjpeg)
// GET  /api/mobile/preview/ws?sessionId=xxx
//                                   → 101 Switching Protocols,WebSocket 帧流(scrcpy)
//
// kind 三种:
//   - screenshot  : SSE,本地 adb / hdc / WDA,远端 mobile-agent HTTP /screencap
//   - scrcpy      : WS,本地直接 @yume-chan/adb-scrcpy,远端 mobile-agent WS 中转
//   - mjpeg       : SSE,multipart/x-mixed-replace(WDA + wda-mjpeg)
//
// `serial` 字段:远端 mobile-agent 一台机器上可能接多台手机,UI 选的是其中一台,
// 所以需要把 serial 一起传过来;本地设备 id 本身已带 serial(`local:android:<serial>`),
// serial 字段可省略。

import { Router, Request, Response, NextFunction } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authMiddleware } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import {
  startPreviewSession,
  stopSession,
  streamSessionSse,
  hasSession,
  getScrcpySessionDeps,
} from '../mobile-preview/proxy.js';
import { bridgeScrcpySession, bridgeLocalScrcpySession } from '../mobile-preview/scrcpy-relay.js';

export const mobilePreviewRoutes = Router();
// 2026-06-10: 不要在这里 router.use(authMiddleware) — 那是全局的,会先把 /stream 拦
// 死(返 401),sseTokenQueryFallback 永远没机会跑。改成每个路由单独挂:
//   - /start / /stop 走 authMiddleware(POST + Authorization header,正常 fetch)
//   - /stream        走 sseTokenQueryFallback(EventSource 不支持 header,走 ?token=)

const VALID_KINDS = new Set(['screenshot', 'scrcpy', 'mjpeg']);

/**
 * 2026-06-10: SSE query-token 认证。
 * 浏览器原生 EventSource 不能设 Authorization header(API 限制),所以 SSE /stream
 * 走 ?token=<jwt> query。WebSocket 升级那边已经用同样模式(自己读 token,不挂这个)。
 */
function sseTokenQueryFallback(req: Request, res: Response, next: NextFunction): void {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(401).json({ code: 401, message: 'Authentication required: ?token= <jwt> query' });
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

mobilePreviewRoutes.post('/start', authMiddleware, async (req: Request, res: Response) => {
  const { deviceId, kind, caseExecutionId, serial } = req.body || {};
  if (deviceId === undefined || deviceId === null) {
    res.status(400).json({ code: 400, message: 'deviceId is required' });
    return;
  }
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
    res.status(400).json({ code: 400, message: `Invalid kind: ${kind}` });
    return;
  }
  const session = await startPreviewSession({
    userId: req.user!.userId,
    deviceId,
    kind: kind as 'screenshot' | 'scrcpy' | 'mjpeg',
    caseExecutionId: typeof caseExecutionId === 'number' ? caseExecutionId : undefined,
    serial: typeof serial === 'string' && serial ? serial : undefined,
  });
  if (!session) {
    res.status(400).json({
      code: 400,
      message: 'Cannot start preview: device unavailable, kind unsupported, or platform not detected',
    });
    return;
  }
  res.json({ code: 200, message: 'ok', data: session });
});

mobilePreviewRoutes.post('/stop', authMiddleware, (req: Request, res: Response) => {
  const { sessionId } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ code: 400, message: 'sessionId is required' });
    return;
  }
  const ok = stopSession(sessionId);
  res.json({ code: 200, message: ok ? 'stopped' : 'session not found', data: { ok } });
});

mobilePreviewRoutes.get('/stream', sseTokenQueryFallback, (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId) {
    res.status(400).json({ code: 400, message: 'sessionId is required' });
    return;
  }
  if (!hasSession(sessionId)) {
    res.status(404).json({ code: 404, message: 'session not found or already stopped' });
    return;
  }
  console.log(`[preview:route] SSE stream accept user=${req.user!.userId} sessionId=${sessionId}`);
  streamSessionSse(sessionId, res);
});

// ── 2026-06-08: scrcpy WebSocket 中转端点 ──
//
// 路径 GET /api/mobile/preview/ws?sessionId=xxx&token=<jwt>
//   - sessionId 必须是 start 接口返回的,且 kind=scrcpy
//   - token 是当前用户的 JWT(浏览器原生 WS 不能设 Authorization header,所以走 query)
//   - 升级成 WebSocket 后,server 调 mobile-agent 启 scrcpy,然后双向透传 H.264
//   - 客户端断 / upstream 断 / metadata 超时都触发清理

const SCRCPY_WS_PATH = '/api/mobile/preview/ws';

export function attachScrcpyWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const path = url.split('?')[0];
    if (path !== SCRCPY_WS_PATH) {
      // 不是我们的升级请求,放给别的 handler(socket 留着)
      return;
    }
    const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
    const token = parsedUrl.searchParams.get('token') ?? '';
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as Duplex, head, (ws) => {
      const sessionId = parsedUrl.searchParams.get('sessionId') ?? '';
      handleScrcpyConnection(ws, req, sessionId, payload.userId);
    });
  });
}

async function handleScrcpyConnection(ws: WebSocket, req: IncomingMessage, sessionId: string, userId: number): Promise<void> {
  if (!sessionId) {
    try { ws.close(1008, 'sessionId query required'); } catch { /* ignore */ }
    return;
  }
  const entry = getScrcpySessionDeps(sessionId);
  if (!entry) {
    try { ws.close(1008, 'session not found'); } catch { /* ignore */ }
    return;
  }
  if (entry.userId !== userId) {
    // 跨用户尝试接入别人的 session:拒绝(防越权)
    try { ws.close(1008, 'session belongs to another user'); } catch { /* ignore */ }
    return;
  }
  if (entry.kind === 'local') {
    // 2026-06-10: 本地 in-process scrcpy,device-keyed 共享。sessionId 只是 preview 的订阅 id,
    // 实际流由 local-scrcpy.ts 按 serial(deviceKey)共享,attachSharedScrcpySubscriber 把 ws 加入订阅者。
    await bridgeLocalScrcpySession(ws, entry.serial);
    return;
  }
  // entry.kind === 'remote'
  await bridgeScrcpySession(ws, req, {
    agentBaseUrl: entry.agentBaseUrl,
    agentToken: entry.agentToken,
    serial: entry.serial,
  });
}
