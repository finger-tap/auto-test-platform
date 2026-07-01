// 2026-06-08: mobile-agent 端 scrcpy 服务 — H.264 屏幕流 → WebSocket
//
// 跟 web-agent 平级,跑在远端 Linux 机器上,本机接 Android 设备。
// 调用方(server 端经 SSH 隧道过来的 mobile-agent WS)POST /scrcpy/start {serial}
// 启动一个 scrcpy 会话,拿到 sessionId;之后 GET /scrcpy/stream/:sessionId
// 升级 WebSocket,server 端把 binary H.264 帧透传到前端 WebCodecs 解码。
//
// 为什么不让 server 端自己 adb:Android 设备插在远端 machine 上,server 进程
// 看不到;要么 SSH 隧道 adb-server 端口(更复杂),要么 mobile-agent 自己
// 跑 adb / scrcpy,只把 H.264 字节流暴露给 server。本文件选后者,理由:
//  - 跟 web-agent 一致(agent 跑 Playwright,server 只连 wsEndpoint)
//  - 复用 @yume-chan/adb-scrcpy client,midscene 同款实现
//  - server 端零修改即可用,scrcpy 协议封装在 mobile-agent 内部
//
// 生命周期:startScrcpySession() 启动后,scrcpy client + videoStream + WS handler
// 都在一个 ActiveSession 里。WS 断开 / 调用 stop() 都触发清理,关 adb / scrcpy 进程。
//
// 文件路径:scrcpy-server 二进制放在 mobile-agent-bin/scrcpy-server(bundler 同步到
// 远端当前 mobile agent 安装目录下的 mobile-agent-bin/scrcpy-server)。pushServer
// 把它推到设备,然后用 DefaultServerPath(Genymobile 默认)作为设备端 classpath。

import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { ReadableStream } from '@yume-chan/stream-extra';
import { DefaultServerPath, ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import { encodeScrcpyFrame } from '../shared/scrcpy-format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 远端部署后:mobile-agent-src/scrcpy.js → ../mobile-agent-bin/scrcpy-server
// 本地 dev:src/agent-mobile/scrcpy.ts → ./bin/scrcpy-server
const SCRCPY_SERVER_BIN = (() => {
  if (process.env.SCRCPY_SERVER_BIN) return process.env.SCRCPY_SERVER_BIN;
  const deployedPath = path.resolve(__dirname, '..', 'mobile-agent-bin', 'scrcpy-server');
  if (existsSync(deployedPath)) return deployedPath;
  return path.resolve(__dirname, 'bin', 'scrcpy-server');
})();

const ADB_SERVER_PORT = Number(process.env.ADB_SERVER_PORT || 5037);

const SCRCPY_PUSH_TIMEOUT_MS = 30_000;
const SCRCPY_START_TIMEOUT_MS = 15_000;
const SCRCPY_VIDEO_TIMEOUT_MS = 10_000;

let adbClientSingleton: AdbServerClient | null = null;

async function getAdbClient(): Promise<AdbServerClient> {
  if (adbClientSingleton) return adbClientSingleton;
  adbClientSingleton = new AdbServerClient(
    new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: ADB_SERVER_PORT }),
  );
  return adbClientSingleton;
}

async function getAdb(serial: string): Promise<Adb> {
  const client = await getAdbClient();
  return new Adb(await client.createTransport({ serial }));
}

interface ActiveScrcpySession {
  id: string;
  serial: string;
  client: AdbScrcpyClient<AdbScrcpyOptions3_3_3<true>>;
  metadata: { codec: ScrcpyVideoCodecId; width: number; height: number };
  startedAt: number;
}

const activeSessions = new Map<string, ActiveScrcpySession>();

export interface StartScrcpyResult {
  sessionId: string;
  serial: string;
  metadata: { codec: ScrcpyVideoCodecId; width: number; height: number };
}

export async function startScrcpySession(opts: {
  serial: string;
  maxSize?: number;
  videoBitRate?: number;
}): Promise<StartScrcpyResult> {
  const { serial, maxSize = 1024, videoBitRate = 2_000_000 } = opts;
  const t0 = Date.now();
  const adb = await getAdb(serial);

  console.log(`[mobile-agent:scrcpy] pushing server bin=${SCRCPY_SERVER_BIN}`);
  await withTimeout(
    AdbScrcpyClient.pushServer(adb, ReadableStream.from(createReadStream(SCRCPY_SERVER_BIN))),
    SCRCPY_PUSH_TIMEOUT_MS,
    'pushing scrcpy-server to device',
  );

  const scrcpyOptions = new AdbScrcpyOptions3_3_3({
    audio: false,
    control: true,
    maxSize,
    sendFrameMeta: true,
    videoBitRate,
  });

  console.log(`[mobile-agent:scrcpy] starting client serial=${serial}`);
  const client = await withTimeout(
    AdbScrcpyClient.start(adb, DefaultServerPath, scrcpyOptions),
    SCRCPY_START_TIMEOUT_MS,
    'starting scrcpy service on device',
  );

  // videoStream is a Promise<AdbScrcpyVideoStream>
  const videoStream = await withTimeout(
    client.videoStream,
    SCRCPY_VIDEO_TIMEOUT_MS,
    'waiting for scrcpy video stream',
  );

  const meta = videoStream.metadata;
  // meta.codec 可能是 ScrcpyVideoCodecId.H264 或 H265,这里窄成 H264 默认
  const codec = (meta.codec ?? ScrcpyVideoCodecId.H264) as ScrcpyVideoCodecId;
  const width = (meta as { width?: number }).width ?? 1080;
  const height = (meta as { height?: number }).height ?? 1920;
  const metadata = { codec, width, height };

  const sessionId = `scrcpy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  activeSessions.set(sessionId, {
    id: sessionId,
    serial,
    client,
    metadata,
    startedAt: Date.now(),
  });
  console.log(`[mobile-agent:scrcpy] started sessionId=${sessionId} serial=${serial} ${width}x${height} took=${Date.now() - t0}ms`);
  return { sessionId, serial, metadata };
}

export function getScrcpySession(sessionId: string): ActiveScrcpySession | undefined {
  return activeSessions.get(sessionId);
}

export async function stopScrcpySession(sessionId: string): Promise<boolean> {
  const s = activeSessions.get(sessionId);
  if (!s) return false;
  activeSessions.delete(sessionId);
  try {
    await s.client.close();
  } catch (e) {
    console.log(`[mobile-agent:scrcpy] stop sessionId=${sessionId} close error: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`[mobile-agent:scrcpy] stopped sessionId=${sessionId}`);
  return true;
}

export function activeScrcpySessionCount(): number {
  return activeSessions.size;
}

/**
 * 把指定 session 的 H.264 帧流附到一个 ws(由调用方管理生命周期)。
 * 协议:第一条消息是 JSON metadata(便于 client 初始化 decoder),后续每条
 * 是 binary frame(1字节 type 前缀 + H.264 payload):
 *   type=0x00 → configuration (SPS/PPS)
 *   type=0x01 → data (H.264 NAL unit)
 * 跟 server 端 local-scrcpy.ts 和前端 useScrcpyDecoder 协议一致。
 */
export async function attachScrcpyStream(sessionId: string, ws: WebSocket): Promise<boolean> {
  const s = activeSessions.get(sessionId);
  if (!s) return false;

  // 1. 第一个消息:metadata(JSON)
  ws.send(JSON.stringify({
    type: 'metadata',
    serial: s.serial,
    codec: s.metadata.codec,
    width: s.metadata.width,
    height: s.metadata.height,
  }));

  // 2. 重新拿 videoStream(可能已经被消费过 — 保险起见重新读)
  //    ActiveSession 在 start 时已 await 过 videoStream,所以这个 Promise
  //    会立即 resolve。stream 只能消费一次,所以 attach 一次就 OK,再 attach
  //    会拿到 closed stream。这种情况我们用 once 兜底。
  let videoStream;
  try {
    videoStream = await s.client.videoStream;
  } catch (e) {
    console.log(`[mobile-agent:scrcpy] attach sessionId=${sessionId} videoStream re-await failed: ${e instanceof Error ? e.message : String(e)}`);
    ws.close(1011, 'video stream unavailable');
    return false;
  }

  const reader = videoStream.stream.getReader();
  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    try { await reader.cancel(); } catch { /* ignore */ }
  };

  ws.on('close', () => { void cleanup(); });
  ws.on('error', () => { void cleanup(); });

  void (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (ws.readyState !== ws.OPEN) break;
        // 编码为 [1字节type + payload] 格式,跟 local-scrcpy 和前端 useScrcpyDecoder 一致
        const payload = encodeScrcpyFrame(value);
        ws.send(payload, { binary: true }, (err) => {
          if (err && !stopped) {
            console.log(`[mobile-agent:scrcpy] ws send error sessionId=${sessionId}: ${err.message}`);
            void cleanup();
          }
        });
      }
    } catch (e) {
      console.log(`[mobile-agent:scrcpy] read loop sessionId=${sessionId} error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      try { ws.close(1000, 'stream ended'); } catch { /* ignore */ }
    }
  })();
  return true;
}

// ── helpers ──

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 把 scrcpy 流 handler 挂到现有 ws server(在 index.ts 里调一次)。
 * 协议:
 *   GET  /scrcpy/stream/:sessionId  → 101 Switching Protocols,WebSocket 升级
 *                                      第一帧 JSON metadata,之后 binary H.264
 */
export function attachScrcpyWebsocketHandlers(wss: WebSocketServer): void {
  wss.on('connection', (ws, req) => {
    const url = req.url || '';
    const m = url.match(/^\/scrcpy\/stream\/([^/?]+)/);
    if (!m) {
      ws.close(1008, 'unexpected path');
      return;
    }
    const sessionId = decodeURIComponent(m[1]);
    attachScrcpyStream(sessionId, ws).then((ok) => {
      if (!ok) {
        try { ws.close(1008, `session not found: ${sessionId}`); } catch { /* ignore */ }
      }
    }).catch((e) => {
      console.error(`[mobile-agent:scrcpy] attach error: ${e instanceof Error ? e.message : String(e)}`);
      try { ws.close(1011, 'internal error'); } catch { /* ignore */ }
    });
  });
}
