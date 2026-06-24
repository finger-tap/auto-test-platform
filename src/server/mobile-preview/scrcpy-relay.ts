// 2026-06-08: scrcpy H.264 → WebSocket 中转(server 端)
//
// 流程(local,2026-06-10 重构为共享模型):
//   1. 客户端(server 端 WS handler)连进来,带上 ?sessionId=xxx
//   2. server 从 proxy.ts 拿 active session 的 serial,转发到 local-scrcpy 的共享 deviceKey
//   3. attachSharedScrcpySubscriber 把这个 ws 加入 subscribers,共享 reader fan-out 字节流
//   4. metadata 由 attachSharedScrcpySubscriber 内部发,后续 binary 帧(1 字节 type + payload)透传
//   5. 客户端断 → detachSharedScrcpySubscriber(viewer 数 -1),viewer=0 时启动 60s 回收
//
// 流程(remote,沿用原 agent-mobile 路径):
//   1. 客户端(server 端 WS handler)连进来,带上 ?sessionId=xxx
//   2. server 调 mobile-agent POST /scrcpy/start { serial } → 拿到 agentSessionId
//   3. server 开一个上游 WebSocket 连接到 mobile-agent /scrcpy/stream/:agentSessionId
//   4. 上游第一帧是 JSON metadata,server 透传给客户端(不解释)
//   5. 之后每条 binary 帧(H.264 configuration/data)server 透传给客户端
//   6. 客户端断 → server 关上游 WS + POST /scrcpy/stop { sessionId }
//
// 失败语义:任何一步失败(mobile-agent start / 上游 WS 断 / metadata 超时 / local
// session 没了)都关客户端 WS 并清资源。客户端不应该收到一半 stream 然后卡住。
//
// 关键不变量:对每个客户端 WS,server 端只持有一个上游源 + 一个 active session,
// 三者生命周期绑定(共享一个 cleanup function)。

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket } from 'ws';
import { attachSharedScrcpySubscriber } from './local-scrcpy.js';

const UPGRADE_TIMEOUT_MS = 8_000;
const FIRST_FRAME_TIMEOUT_MS = 12_000;

export interface ScrcpyRelayDeps {
  /** 远端 agent base URL,例如 http://192.168.1.50:4002 */
  agentBaseUrl: string;
  /** mobile-agent 的 bearer token */
  agentToken: string;
  /** Android 设备 adb serial */
  serial: string;
  /** 调试日志 prefix(默认 'scrcpy-relay') */
  logPrefix?: string;
}

export interface ScrcpyRelayResult {
  ok: boolean;
  error?: string;
}

/**
 * 把 client WS(由 ws server upgrade 传入)和 mobile-agent 的 scrcpy 流串起来。
 * 完成后 client WS 会被关闭,upstream WS 也会被关闭。
 */
export async function bridgeScrcpySession(
  clientWs: WebSocket,
  req: IncomingMessage,
  deps: ScrcpyRelayDeps,
): Promise<ScrcpyRelayResult> {
  const log = (msg: string) => console.log(`[${deps.logPrefix ?? 'scrcpy-relay'}] ${msg}`);

  if (clientWs.readyState !== WebSocket.OPEN) {
    return { ok: false, error: 'client ws not open' };
  }

  // 1. 启动 agent 端 scrcpy session
  const started = await startAgentScrcpy(deps);
  if (started.ok === false) {
    try { clientWs.close(1011, `agent start failed: ${started.error}`); } catch { /* ignore */ }
    return started;
  }
  const { sessionId: agentSessionId } = started;
  log(`serial=${deps.serial} agentSessionId=${agentSessionId} bridging`);

  // 2. 开上游 WebSocket
  const upstreamUrl = agentStreamUrl(deps.agentBaseUrl, agentSessionId, deps.agentToken);
  // 必须在 await open 之前就 attach message / error / close 处理,
  // 否则 mobile-agent 在 open 事件后立刻发的 metadata 第一帧会丢(EventEmitter
  // 没有 queue,emit 完即过,后注册的 listener 不会收到)。
  const upstream = createUpstreamWebSocket(upstreamUrl);

  // 3. 透传管道
  let closed = false;
  const cleanup = async (reason: string) => {
    if (closed) return;
    closed = true;
    log(`serial=${deps.serial} agentSessionId=${agentSessionId} cleanup reason=${reason}`);
    try { upstream.close(); } catch { /* ignore */ }
    try { clientWs.close(1000, reason); } catch { /* ignore */ }
    await stopAgentScrcpy(deps.agentBaseUrl, agentSessionId, deps.agentToken).catch(() => {});
  };

  // 3a. upstream → client(直接 binary 透传,不做格式解释)
  let firstFrameSeen = false;
  const firstFrameTimer = setTimeout(() => {
    if (!firstFrameSeen && !closed) {
      void cleanup('upstream first-frame timeout');
    }
  }, FIRST_FRAME_TIMEOUT_MS);

  upstream.on('message', (data, isBinary) => {
    if (closed) return;
    firstFrameSeen = true;
    clearTimeout(firstFrameTimer);
    if (clientWs.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      clientWs.send(data, { binary: true });
    } else {
      // upstream 第一帧是 JSON metadata,透传
      clientWs.send(data.toString('utf8'));
    }
  });

  upstream.on('error', (err) => {
    if (closed) return;
    log(`upstream error serial=${deps.serial} agentSessionId=${agentSessionId}: ${err.message}`);
    void cleanup('upstream error');
  });
  upstream.on('close', (code, reason) => {
    if (closed) return;
    log(`upstream close code=${code} reason=${reason.toString()}`);
    void cleanup('upstream closed');
  });

  // 等到 open 完成(或超时)再继续
  try {
    await waitForOpen(upstream, UPGRADE_TIMEOUT_MS);
  } catch (e) {
    await stopAgentScrcpy(deps.agentBaseUrl, agentSessionId, deps.agentToken);
    const msg = e instanceof Error ? e.message : String(e);
    try { clientWs.close(1011, `upstream open failed: ${msg}`); } catch { /* ignore */ }
    return { ok: false, error: `upstream open failed: ${msg}` };
  }

  // 3b. client → upstream(目前只读不写,留 hook 给未来触摸/按键)
  clientWs.on('message', (data, isBinary) => {
    if (closed) return;
    if (isBinary) return;   // 不接受 client 发 binary(scrcpy 是单向流)
    // 文本消息 — 协议保留:可能用于 ping/control meta
    const s = data.toString('utf8');
    if (s === 'ping') {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send('pong');
    }
    // 其他文本协议忽略
  });

  clientWs.on('error', (err) => {
    if (closed) return;
    log(`client error: ${err.message}`);
    void cleanup('client error');
  });
  clientWs.on('close', (code, reason) => {
    if (closed) return;
    log(`client close code=${code} reason=${reason.toString()}`);
    void cleanup('client closed');
  });

  return { ok: true };
}

// ── helpers ──

interface StartOk { ok: true; sessionId: string }
interface StartErr { ok: false; error: string }

async function startAgentScrcpy(deps: ScrcpyRelayDeps): Promise<StartOk | StartErr> {
  const url = `${deps.agentBaseUrl.replace(/\/$/, '')}/scrcpy/start`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deps.agentToken}`,
      },
      body: JSON.stringify({ serial: deps.serial }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `agent start http=${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { code?: number; data?: { sessionId?: string } };
    const sessionId = json?.data?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) {
      return { ok: false, error: 'agent start response missing data.sessionId' };
    }
    return { ok: true, sessionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function stopAgentScrcpy(agentBaseUrl: string, sessionId: string, agentToken: string): Promise<void> {
  const url = `${agentBaseUrl.replace(/\/$/, '')}/scrcpy/stop`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.log(`[scrcpy-relay] stop agent sessionId=${sessionId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function agentStreamUrl(agentBaseUrl: string, sessionId: string, agentToken: string): string {
  const u = new URL(agentBaseUrl);
  const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  // token 走 query(避免浏览器原生 WS 没法加 header)
  return `${protocol}//${u.host}/scrcpy/stream/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(agentToken)}`;
}

/** 同步创建 upstream WS(不 await open),让调用方在 await 前 attach handler */
function createUpstreamWebSocket(url: string): WebSocket {
  return new WebSocket(url);
}

/** await upstream WS open(或超时)。必须在 createUpstreamWebSocket 之后调用。 */
function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    let settled = false;
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch { /* ignore */ }
      reject(new Error(`upstream open timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.once('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', onError);
  });
}

// Type-only re-export — avoids importing WebSocketServer (noServer mode) by callers.
export type { Duplex, IncomingMessage };

/**
 * 2026-06-10: 把 client WS 接到本地共享 scrcpy 流(device-keyed,见 local-scrcpy.ts)。
 * serial 来自 proxy.ts 的 ScrcpySessionEntry,server 端按 deviceKey 共享一个 scrcpy 进程。
 * 失败时关 client WS;viewer 关闭时 attachSharedScrcpySubscriber 内部自动 detach。
 */
export async function bridgeLocalScrcpySession(
  clientWs: WebSocket,
  serial: string,
): Promise<ScrcpyRelayResult> {
  const log = (msg: string) => console.log(`[scrcpy-relay:local] ${msg}`);
  if (clientWs.readyState !== WebSocket.OPEN) {
    return { ok: false, error: 'client ws not open' };
  }
  const ok = await attachSharedScrcpySubscriber(serial, clientWs);
  if (!ok) {
    try { clientWs.close(1008, `local scrcpy session not found: serial=${serial}`); } catch { /* ignore */ }
    return { ok: false, error: 'attachSharedScrcpySubscriber failed (no active shared session for serial)' };
  }
  log(`bridging serial=${serial}`);
  return { ok: true };
}
