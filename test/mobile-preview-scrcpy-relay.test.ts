// 2026-06-08: scrcpy-relay.ts 集成测试 — 用本地 mock agent 验证 bridge
//
// 跑一个临时的 HTTP + WS server 模拟 mobile-agent:
//   - POST /scrcpy/start → 返回 { code: 200, data: { sessionId } }
//   - POST /scrcpy/stop → 收到 body 后返回 ok
//   - WS /scrcpy/stream/:id → 第一帧 JSON metadata,之后 binary 帧
// client 端用本地 WS server upgrade 一个 ws 模拟 server 端 upgrade 出来的 client WS,
// 走 bridgeScrcpySession 验证透传逻辑。
//
// 验证点:
//   1. metadata 文本帧从 upstream → client 透传
//   2. 后续 binary H.264 帧原样透传
//   3. 客户端关闭 → 调 agent /scrcpy/stop
//   4. agent /scrcpy/start 失败时关闭 client WS 并返回 ok=false

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { bridgeScrcpySession } from '../src/server/mobile-preview/scrcpy-relay.js';

interface MockAgent {
  baseUrl: string;
  stops: Array<{ sessionId: string }>;
  setFailStart: (v: boolean) => void;
  pushBinary: (sessionId: string, data: Buffer) => boolean;
  close: () => Promise<void>;
}

async function startMockAgent(): Promise<MockAgent> {
  const stops: Array<{ sessionId: string }> = [];
  let failStart = false;
  const pushFns = new Map<string, (data: Buffer) => void>();
  const wssClients = new Map<string, WebSocket>();

  const httpServer = http.createServer((req, res) => {
    if (!req.url) { res.statusCode = 404; res.end(); return; }
    if (req.method === 'POST' && req.url === '/scrcpy/start') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (failStart) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ code: 500, message: 'mocked fail' }));
          return;
        }
        const parsed = JSON.parse(body || '{}') as { serial?: string };
        const sessionId = `mock-${Math.random().toString(36).slice(2, 8)}`;
        pushFns.set(sessionId, (data: Buffer) => {
          const client = wssClients.get(sessionId);
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: true });
          }
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          code: 200,
          message: 'ok',
          data: { sessionId, serial: parsed.serial ?? '' },
        }));
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/scrcpy/stop') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { sessionId?: string };
        if (parsed.sessionId) stops.push({ sessionId: parsed.sessionId });
        const c = wssClients.get(parsed.sessionId ?? '');
        try { c?.close(1000, 'stopped'); } catch { /* ignore */ }
        wssClients.delete(parsed.sessionId ?? '');
        pushFns.delete(parsed.sessionId ?? '');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ code: 200, message: 'ok', data: { ok: true } }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const m = url.match(/^\/scrcpy\/stream\/([^/?]+)/);
    if (!m) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sessionId = decodeURIComponent(m[1]);
      wssClients.set(sessionId, ws);
      // 模拟真实 mobile-agent: 设备侧 scrcpy-server 启动后异步发 metadata
      // 这里用 setImmediate 让 bridge 有机会在第一帧到达前挂上 message 监听器
      setImmediate(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'metadata', serial: 'mock-serial', codec: 1, width: 720, height: 1280 }));
        }
      });
      ws.on('close', () => { wssClients.delete(sessionId); });
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    stops,
    setFailStart: (v: boolean) => { failStart = v; },
    pushBinary: (sessionId, data) => {
      const fn = pushFns.get(sessionId);
      if (!fn) return false;
      fn(data);
      return true;
    },
    close: () => new Promise<void>((resolve) => {
      for (const ws of wssClients.values()) {
        try { ws.terminate(); } catch { /* ignore */ }
      }
      wssClients.clear();
      pushFns.clear();
      httpServer.close(() => resolve());
    }),
  };
}

/** 启一个本地 server,接受 upgrade 后返回 client WS 引用 */
function makeClientHarness(): Promise<{
  server: http.Server;
  wss: WebSocketServer;
  port: number;
  acceptOne: () => Promise<WebSocket>;
  received: Array<{ data: string | Buffer; isBinary: boolean }>;
  close: () => Promise<void>;
}> {
  return new Promise((resolveOuter) => {
    const received: Array<{ data: string | Buffer; isBinary: boolean }> = [];
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const acceptQueue: Array<(ws: WebSocket) => void> = [];

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data, isBinary) => {
          received.push({ data: isBinary ? data : data.toString('utf8'), isBinary });
        });
        const resolver = acceptQueue.shift();
        if (resolver) resolver(ws);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveOuter({
        server, wss, port, received,
        acceptOne: () => new Promise<WebSocket>((r) => acceptQueue.push(r)),
        close: () => new Promise<void>((resolve) => {
          wss.clients.forEach((c) => c.terminate());
          wss.close(() => server.close(() => resolve()));
        }),
      });
    });
  });
}

function safeTerminate(ws: WebSocket | null): void {
  if (!ws) return;
  // ws 在未建立连接前 terminate 会异步 emit error,必须先挂 error handler
  // 才能避免 unhandled error event 抛出
  ws.on('error', () => { /* swallow */ });
  try { ws.terminate(); } catch { /* ignore */ }
}

test('bridge — client ws 未 OPEN 时直接返回 ok=false', async () => {
  const agent = await startMockAgent();
  try {
    // 构造一个永远连不上的 client WS
    const clientWs = new WebSocket('ws://127.0.0.1:1');
    const result = await bridgeScrcpySession(clientWs, {} as never, {
      agentBaseUrl: agent.baseUrl,
      agentToken: 'mock-token',
      serial: 'mock-serial',
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /client ws not open/);
    safeTerminate(clientWs);
  } finally {
    await agent.close();
  }
});

test('bridge — agent /scrcpy/start 失败时关闭 client WS 并返回 ok=false', async () => {
  const agent = await startMockAgent();
  agent.setFailStart(true);
  const client = await makeClientHarness();
  let clientWs: WebSocket | null = null;
  try {
    clientWs = new WebSocket(`ws://127.0.0.1:${client.port}`);
    const accepted = await client.acceptOne();
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      accepted.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    const result = await bridgeScrcpySession(accepted, {} as never, {
      agentBaseUrl: agent.baseUrl,
      agentToken: 'mock-token',
      serial: 'mock-serial',
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /agent start http=500/);
    const closeInfo = await Promise.race([
      closed,
      new Promise<{ code: number; reason: string }>((r) => setTimeout(() => r({ code: -1, reason: 'timeout' }), 2000)),
    ]);
    assert.equal(closeInfo.code, 1011, `client WS 应该被 1011 关闭,实际 code=${closeInfo.code}`);
  } finally {
    safeTerminate(clientWs);
    await client.close();
    await agent.close();
  }
});

async function waitOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });
}

test('bridge — metadata 文本帧透传到 client + ping/pong', async () => {
  const agent = await startMockAgent();
  const client = await makeClientHarness();
  // 收到的消息:把 clientWs(test 的 client 端)收的也 push 到同一个 received
  const allReceived: Array<{ data: string | Buffer; isBinary: boolean }> = [];
  let clientWs: WebSocket | null = null;
  try {
    clientWs = new WebSocket(`ws://127.0.0.1:${client.port}`);
    clientWs.on('message', (data, isBinary) => {
      allReceived.push({ data: isBinary ? data : data.toString('utf8'), isBinary });
    });
    const accepted = await client.acceptOne();
    await waitOpen(accepted);

    const result = await bridgeScrcpySession(accepted, {} as never, {
      agentBaseUrl: agent.baseUrl,
      agentToken: 'mock-token',
      serial: 'mock-serial',
    });
    assert.equal(result.ok, true);

    // 等 metadata 抵达 client
    for (let i = 0; i < 30 && !allReceived.some((m) => !m.isBinary); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const meta = allReceived.find((m) => !m.isBinary);
    assert.ok(meta, 'client 应该收到 metadata 文本帧');
    const parsed = JSON.parse(meta!.data as string);
    assert.equal(parsed.type, 'metadata');
    assert.equal(parsed.width, 720);
    assert.equal(parsed.height, 1280);

    // ping/pong:从 clientWs 发 'ping',bridge 应回 'pong' 到 clientWs
    clientWs.send('ping');
    for (let i = 0; i < 10 && !allReceived.some((m) => m.data === 'pong'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const pong = allReceived.find((m) => !m.isBinary && m.data === 'pong');
    assert.ok(pong, 'client 应该收到 pong 响应');
  } finally {
    safeTerminate(clientWs);
    await client.close();
    await agent.close();
  }
});

test('bridge — 客户端关闭时调 agent /scrcpy/stop', async () => {
  const agent = await startMockAgent();
  const client = await makeClientHarness();
  let clientWs: WebSocket | null = null;
  try {
    clientWs = new WebSocket(`ws://127.0.0.1:${client.port}`);
    const accepted = await client.acceptOne();
    await waitOpen(accepted);

    await bridgeScrcpySession(accepted, {} as never, {
      agentBaseUrl: agent.baseUrl,
      agentToken: 'mock-token',
      serial: 'mock-serial',
    });
    // 等 metadata 到 clientWs(确保 start 已完成)
    await new Promise((r) => setTimeout(r, 300));
    const beforeStops = agent.stops.length;

    // 客户端关闭:从 test 的 clientWs 关,模拟浏览器关闭标签
    clientWs.close();
    await new Promise((r) => setTimeout(r, 300));

    assert.ok(
      agent.stops.length > beforeStops,
      `agent /scrcpy/stop 应该有调用,实际 stops 数从 ${beforeStops} → ${agent.stops.length}`,
    );
  } finally {
    safeTerminate(clientWs);
    await client.close();
    await agent.close();
  }
});
