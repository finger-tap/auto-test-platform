// 2026-06-08: mobile-agent service entry point.
//
// 跟 src/agent-web/ 平级的独立 Node 服务,跑在远端 Linux 机器,本机接 Android 设备。
// 区别于 web-agent:
//   - listen 4002(AGENT_MOBILE_PORT,跟 web-agent 4001 区分)
//   - 不暴露 /launch(adb 行为由 server 端经 SSH 隧道直接调,不在 agent 中转)
//   - 暴露 /screencap(纯文件传输,server 端 preview 循环拉)+ /devices(register 时上报 metadata)
//   - 暴露 /scrcpy/start + /scrcpy/stream/:sessionId(H.264 屏幕流,server 经 WS 中转给前端)
//
// SSH 隧道由 server 端开:server → ssh ssh_host -L 127.0.0.1:RANDOM:127.0.0.1:5037
// 然后 server 当 adb -P RANDOM 走隧道连本机 adb-server。这样 agent 不暴露 adb 协议面。

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { verifyServerRequest } from './auth.js';
import { startHeartbeatLoop, stopHeartbeatLoop, sendShutdown } from './heartbeat.js';
import { screencapOnce, listLocalMobile, type MobilePlatform } from './preview.js';
import { startScrcpySession, stopScrcpySession, attachScrcpyWebsocketHandlers, activeScrcpySessionCount } from './scrcpy.js';

const AGENT_MOBILE_PORT = Number(process.env.AGENT_MOBILE_PORT || 4002);
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL;
const AGENT_NAME = process.env.AGENT_NAME || 'mobile-agent';

if (!AGENT_TOKEN) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_TOKEN env var is required`);
  process.exit(1);
}
if (!AGENT_SERVER_URL) {
  console.error(`[${AGENT_NAME}] FATAL: AGENT_SERVER_URL env var is required`);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '64mb' }));   // screencap 单帧可能 ~5MB,留余量

const corsOrigin = process.env.AGENT_CORS_ORIGIN || AGENT_SERVER_URL;
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: false }));

// /healthz — open, no auth
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, name: AGENT_NAME, kind: 'mobile', port: AGENT_MOBILE_PORT, scrcpy_sessions: activeScrcpySessionCount() });
});

// 之后的路由都要 bearer
app.use(verifyServerRequest);

// POST /devices — 列出本机 mobile 设备(Android + Harmony + Mac 上的 iOS)
// Body: (none) → { items: MobileDeviceRow[] }
// register / heartbeat 时 server 端调用,写到 devices.metadata
app.post('/devices', async (_req, res) => {
  try {
    const items = await listLocalMobile();
    res.json({ code: 200, message: 'ok', data: { items } });
  } catch (e) {
    res.status(500).json({
      code: 500,
      message: `failed to list devices: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
});

// POST /screencap — 单帧截图(三平台分发)
// Body: { serial: string, platform: 'android' | 'harmony' | 'ios' }
//   → { image: base64, ts: number }
// server 端 preview-relay 循环调,频率 1-2 FPS
// platform 必传 — 单纯靠 serial 字符串无法可靠区分 hdc udid 跟 adb serial
app.post('/screencap', async (req, res) => {
  const { serial, platform } = req.body || {};
  if (typeof serial !== 'string' || !serial) {
    res.status(400).json({ code: 400, message: 'serial is required' });
    return;
  }
  if (platform !== 'android' && platform !== 'harmony' && platform !== 'ios') {
    res.status(400).json({ code: 400, message: 'platform must be android | harmony | ios' });
    return;
  }
  const buf = await screencapOnce(serial, platform as MobilePlatform);
  if (!buf) {
    res.status(500).json({ code: 500, message: 'screencap failed' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: { image: buf.toString('base64'), ts: Date.now() } });
});

// POST /scrcpy/start — 启动 scrcpy 会话(H.264 流)
// Body: { serial: string, maxSize?: number, videoBitRate?: number }
//   → { sessionId, serial, metadata: { codec, width, height } }
app.post('/scrcpy/start', async (req, res) => {
  const { serial, maxSize, videoBitRate } = req.body || {};
  if (typeof serial !== 'string' || !serial) {
    res.status(400).json({ code: 400, message: 'serial is required' });
    return;
  }
  try {
    const result = await startScrcpySession({
      serial,
      maxSize: typeof maxSize === 'number' ? maxSize : undefined,
      videoBitRate: typeof videoBitRate === 'number' ? videoBitRate : undefined,
    });
    res.json({ code: 200, message: 'ok', data: result });
  } catch (e) {
    res.status(500).json({
      code: 500,
      message: `failed to start scrcpy: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
});

// POST /scrcpy/stop — 停 scrcpy 会话
// Body: { sessionId: string }
app.post('/scrcpy/stop', async (req, res) => {
  const { sessionId } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ code: 400, message: 'sessionId is required' });
    return;
  }
  const ok = await stopScrcpySession(sessionId);
  res.json({ code: 200, message: ok ? 'stopped' : 'session not found', data: { ok } });
});

const httpServer = createServer(app);
const server = httpServer.listen(AGENT_MOBILE_PORT, () => {
  console.log(`[${AGENT_NAME}] listening on http://0.0.0.0:${AGENT_MOBILE_PORT} (server=${AGENT_SERVER_URL})`);
  startHeartbeatLoop({ serverUrl: AGENT_SERVER_URL, agentToken: AGENT_TOKEN, agentPort: AGENT_MOBILE_PORT });
});

// 2026-06-08: scrcpy H.264 流的 WebSocket 端点
// 路径:/scrcpy/stream/:sessionId(upgrade → binary 帧)
const scrcpyWss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (!url.startsWith('/scrcpy/stream/')) {
    socket.destroy();
    return;
  }
  // bearer token 校验(URL query 带 token,跟 REST 路径风格一致)
  const token = new URL(req.url ?? '', `http://${req.headers.host}`).searchParams.get('token');
  if (token !== AGENT_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  scrcpyWss.handleUpgrade(req, socket, head, (ws) => {
    scrcpyWss.emit('connection', ws, req);
  });
});
attachScrcpyWebsocketHandlers(scrcpyWss);

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[${AGENT_NAME}] received ${signal}, shutting down...`);
  stopHeartbeatLoop();
  try {
    await sendShutdown({ serverUrl: AGENT_SERVER_URL!, agentToken: AGENT_TOKEN!, agentPort: AGENT_MOBILE_PORT });
  } catch (e) {
    console.log(`[${AGENT_NAME}] sendShutdown error: ${e instanceof Error ? e.message : String(e)}`);
  }
  // scrcpy 子进程会随 Node 进程退出被 OS 回收,这里不显式 stop。
  server.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
