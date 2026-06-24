// 2026-06-10: 本地 Android 设备的 in-process scrcpy session(共享 + 60s 空闲回收)
//
// 设计要点:
//   - 一台设备 = 一个 SharedScrcpySession,key = `${kind}:${serial}`(例 `android:emulator-5554`)
//   - 多个 viewer(WS)可订阅同一个 session,单 reader fan-out 字节流
//   - viewer 数归零 60s 后自动 forceClose + 删 Map;新 viewer 加入时取消 timer
//   - 远端 agent 端暂不共享(本期 scope,见 proxy.ts TODO)
//
// iOS 设备本机 macOS server 走 screenshot 不走 scrcpy,所以共享模型只服务 Android。
//
// 协议(已对齐客户端 useScrcpyDecoder):
//   第一条 text:JSON metadata
//   之后 binary:1 字节 type prefix(0x00=configuration, 0x01=data) + H.264 payload
//
// 复用:跟 src/agent-mobile/scrcpy.ts 平级,共享 scrcpy-server bin、AdbScrcpyClient。

import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { ReadableStream } from '@yume-chan/stream-extra';
import { DefaultServerPath, ScrcpyVideoCodecId } from '@yume-chan/scrcpy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 跟 mobile-agent 用同一份 scrcpy-server(本地 dev:src/agent-mobile/bin/scrcpy-server;
// 打包后:dist/server/mobile-preview/../../agent-mobile/bin/scrcpy-server)。
// fallback:先找 dev 路径,再找 dist 路径。
function resolveScrcpyServerBin(): string {
  if (process.env.SCRCPY_SERVER_BIN) return process.env.SCRCPY_SERVER_BIN;
  const candidates = [
    // dev: src/server/mobile-preview/local-scrcpy.ts → ../../agent-mobile/bin/
    path.resolve(__dirname, '..', '..', 'agent-mobile', 'bin', 'scrcpy-server'),
    // dist: dist/server/mobile-preview/local-scrcpy.js → ../../agent-mobile/bin/
    path.resolve(__dirname, '..', '..', '..', 'src', 'agent-mobile', 'bin', 'scrcpy-server'),
  ];
  for (const c of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return candidates[0];   // 报错的路径无所谓,start 时会 ENOENT
}

const SCRCPY_SERVER_BIN = resolveScrcpyServerBin();
const ADB_SERVER_PORT = Number(process.env.ADB_SERVER_PORT || 5037);

const SCRCPY_PUSH_TIMEOUT_MS = 30_000;
const SCRCPY_START_TIMEOUT_MS = 15_000;
const SCRCPY_VIDEO_TIMEOUT_MS = 10_000;

// 60s 空闲自动回收(用户拍板的决策)
const SCRCPY_IDLE_TIMEOUT_MS = 60_000;
// 30min 硬 GC(异常兜底,proxy.ts 也会定期扫)
const SCRCPY_HARD_GC_MS = 30 * 60 * 1000;

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

// ── 共享 session 类型 ──

type SubscriberCtx = { ws: WebSocket; closed: boolean };

export interface SharedScrcpyMetadata {
  codec: ScrcpyVideoCodecId;
  width: number;
  height: number;
}

interface SharedScrcpySession {
  deviceKey: string;            // 'android:emulator-5554'
  serial: string;
  client: AdbScrcpyClient<AdbScrcpyOptions3_3_3<true>>;
  metadata: SharedScrcpyMetadata;
  startedAt: number;
  /** 单 reader(从 client.videoStream.stream.getReader() 拿到) */
  reader: ReadableStreamDefaultReader<{ type: 'configuration' | 'data'; data: Uint8Array }> | null;
  /** reader 循环 Promise(给 cancel 引用) */
  readerLoopPromise: Promise<void> | null;
  /** 当前订阅者(viewer WS) */
  subscribers: Map<WebSocket, SubscriberCtx>;
  /** subscribers.size 刚变为 0 的时刻;有新 viewer 进来不会清这个时间戳(下次空闲会刷新) */
  lastIdleAt: number | null;
  /** 60s 回收 timer */
  idleTimer: NodeJS.Timeout | null;
  /** 缓存最近的 configuration 帧(SPS/PPS),新 subscriber attach 时补发 */
  lastConfigFrame: Uint8Array | null;
}

const deviceMap = new Map<string, SharedScrcpySession>();

function deviceKeyFor(serial: string): string {
  return `android:${serial}`;
}

export function getSharedScrcpyViewerCount(serial: string): number {
  return deviceMap.get(deviceKeyFor(serial))?.subscribers.size ?? 0;
}

export function getSharedScrcpyLastIdleAt(serial: string): number | null {
  return deviceMap.get(deviceKeyFor(serial))?.lastIdleAt ?? null;
}

export function forEachSharedScrcpySerial(fn: (serial: string) => void): void {
  for (const k of deviceMap.keys()) {
    const colonIdx = k.indexOf(':');
    if (colonIdx >= 0) fn(k.slice(colonIdx + 1));
  }
}

// ── Idle timer ──

function cancelIdleTimer(session: SharedScrcpySession): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function startIdleTimer(deviceKey: string): void {
  const session = deviceMap.get(deviceKey);
  if (!session) return;
  cancelIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    const s = deviceMap.get(deviceKey);
    if (!s) return;
    if (s.subscribers.size === 0) {
      console.log(`[local-scrcpy] idle 60s — closing deviceKey=${deviceKey} serial=${s.serial}`);
      void forceCloseSharedLocalScrcpy(s.serial);
    } else {
      // 中途又有 viewer 加入了 — 上面 startIdleTimer 会 cancel 旧 timer;走到这里不应该
      console.log(`[local-scrcpy] idle timer fired but subscribers=${s.subscribers.size} — keeping`);
    }
  }, SCRCPY_IDLE_TIMEOUT_MS);
  session.idleTimer.unref();
}

// ── Reader loop(单 reader fan-out 多 subscriber) ──

async function runReaderLoop(session: SharedScrcpySession): Promise<void> {
  if (!session.reader) return;
  const reader = session.reader;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const typeByte = value.type === 'configuration' ? 0x00 : 0x01;
      // 缓存 SPS/PPS configuration 帧,新 subscriber attach 时补发
      if (value.type === 'configuration') {
        const configPayload = new Uint8Array(1 + value.data.length);
        configPayload[0] = 0x00;
        configPayload.set(value.data, 1);
        session.lastConfigFrame = configPayload;
      }
      const payload = new Uint8Array(1 + value.data.length);
      payload[0] = typeByte;
      payload.set(value.data, 1);
      // fan-out:每个 subscriber 独立 send,慢的 WS 只影响自己的 buffer
      for (const sub of session.subscribers.values()) {
        if (sub.closed) continue;
        if (sub.ws.readyState !== sub.ws.OPEN) {
          sub.closed = true;
          continue;
        }
        try {
          sub.ws.send(payload, { binary: true }, (err) => {
            if (err && !sub.closed) {
              console.log(`[local-scrcpy] ws send error deviceKey=${session.deviceKey}: ${err.message}`);
              sub.closed = true;
              try { sub.ws.close(1011, 'send error'); } catch { /* ignore */ }
            }
          });
        } catch (e) {
          // 同步抛错(WS 已经半关) — 标记 closed,不 cancel 共享 reader
          sub.closed = true;
          console.log(`[local-scrcpy] ws send threw deviceKey=${session.deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    console.log(`[local-scrcpy] reader loop error deviceKey=${session.deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // 流自然结束 — 关闭所有剩余 subscriber WS
    for (const sub of session.subscribers.values()) {
      if (!sub.closed) {
        try { sub.ws.close(1000, 'scrcpy stream ended'); } catch { /* ignore */ }
      }
    }
  }
}

// ── Public API ──

/**
 * 幂等:同一台设备(serial)只起一个 scrcpy client。
 * 新 viewer 调用 attachSharedScrcpySubscriber 订阅现有流;无 viewer 时 60s 后自动 forceClose。
 */
export async function getOrCreateSharedLocalScrcpy(opts: {
  serial: string;
  maxSize?: number;
  videoBitRate?: number;
}): Promise<SharedScrcpySession> {
  const { serial, maxSize = 1024, videoBitRate = 2_000_000 } = opts;
  const deviceKey = deviceKeyFor(serial);
  const existing = deviceMap.get(deviceKey);
  if (existing) return existing;

  const t0 = Date.now();
  const adb = await getAdb(serial);

  console.log(`[local-scrcpy] pushing server bin=${SCRCPY_SERVER_BIN} serial=${serial}`);
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

  console.log(`[local-scrcpy] starting client serial=${serial}`);
  const client = await withTimeout(
    AdbScrcpyClient.start(adb, DefaultServerPath, scrcpyOptions),
    SCRCPY_START_TIMEOUT_MS,
    'starting scrcpy service on device',
  );

  const videoStream = await withTimeout(
    client.videoStream,
    SCRCPY_VIDEO_TIMEOUT_MS,
    'waiting for scrcpy video stream',
  );

  const meta = videoStream.metadata;
  const codec = (meta.codec ?? ScrcpyVideoCodecId.H264) as ScrcpyVideoCodecId;
  const width = (meta as { width?: number }).width ?? 1080;
  const height = (meta as { height?: number }).height ?? 1920;
  const metadata: SharedScrcpyMetadata = { codec, width, height };

  const reader = videoStream.stream.getReader();

  const session: SharedScrcpySession = {
    deviceKey,
    serial,
    client,
    metadata,
    startedAt: Date.now(),
    reader,
    readerLoopPromise: null,
    subscribers: new Map(),
    lastIdleAt: null,
    idleTimer: null,
    lastConfigFrame: null,
  };
  deviceMap.set(deviceKey, session);

  // 启动单 reader loop
  session.readerLoopPromise = runReaderLoop(session).catch((e) => {
    console.log(`[local-scrcpy] readerLoop unhandled deviceKey=${deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
  });

  console.log(`[local-scrcpy] created deviceKey=${deviceKey} ${width}x${height} took=${Date.now() - t0}ms`);
  return session;
}

/**
 * 把一个 viewer WS 挂到设备共享流上。第一条 text 消息是 JSON metadata。
 * viewer 数从 0 涨到 ≥1 时,自动取消 60s 回收 timer。
 */
export async function attachSharedScrcpySubscriber(serial: string, ws: WebSocket): Promise<boolean> {
  const deviceKey = deviceKeyFor(serial);
  const session = deviceMap.get(deviceKey);
  if (!session) return false;

  // 1. metadata
  try {
    ws.send(JSON.stringify({
      type: 'metadata',
      serial: session.serial,
      codec: session.metadata.codec,
      width: session.metadata.width,
      height: session.metadata.height,
    }));
  } catch (e) {
    console.log(`[local-scrcpy] attach metadata send failed deviceKey=${deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  // 2. 让 scrcpy 服务端重新发送关键帧(包含 SPS/PPS + IDR),新 subscriber 才能正确解码
  const controller = session.client.controller;
  if (controller) {
    try {
      await controller.resetVideo();
      console.log(`[local-scrcpy] resetVideo sent deviceKey=${deviceKey} for new subscriber`);
    } catch (e) {
      console.log(`[local-scrcpy] resetVideo failed deviceKey=${deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
      // 非致命 — 缓存的 config 帧仍可兜底
    }
  }

  // 3. 加入 subscribers
  const sub: SubscriberCtx = { ws, closed: false };
  session.subscribers.set(ws, sub);

  // 4. 取消 idle timer(viewer 回归)
  if (session.subscribers.size === 1) {
    cancelIdleTimer(session);
    console.log(`[local-scrcpy] attach deviceKey=${deviceKey} serial=${session.serial} viewerCount=${session.subscribers.size}`);
  } else {
    console.log(`[local-scrcpy] attach deviceKey=${deviceKey} serial=${session.serial} viewerCount=${session.subscribers.size}(+1)`);
  }

  // 5. WS 关 → detach
  ws.on('close', () => { detachSharedScrcpySubscriber(session.serial, ws); });
  ws.on('error', () => { detachSharedScrcpySubscriber(session.serial, ws); });
  return true;
}

/**
 * 移除一个 viewer。subscribers.size 归零时启动 60s 回收 timer。
 * **绝不 cancel 共享 reader** — 关闭的只是这一个 viewer 的 WS。
 */
export function detachSharedScrcpySubscriber(serial: string, ws: WebSocket): void {
  const deviceKey = deviceKeyFor(serial);
  const session = deviceMap.get(deviceKey);
  if (!session) return;
  const sub = session.subscribers.get(ws);
  if (!sub) return;
  sub.closed = true;
  session.subscribers.delete(ws);
  if (session.subscribers.size === 0) {
    session.lastIdleAt = Date.now();
    startIdleTimer(deviceKey);
    console.log(`[local-scrcpy] detach deviceKey=${deviceKey} serial=${serial} last viewer — start 60s idle timer`);
  } else {
    console.log(`[local-scrcpy] detach deviceKey=${deviceKey} serial=${serial} viewerCount=${session.subscribers.size}(-1)`);
  }
}

/**
 * 强杀:关 client、关所有剩余 subscriber WS、删 Map。proxy 的 30min 硬 GC 和 force-close 路径会调。
 * cancel 共享 reader 只能在这里。
 */
export async function forceCloseSharedLocalScrcpy(serial: string): Promise<boolean> {
  const deviceKey = deviceKeyFor(serial);
  const session = deviceMap.get(deviceKey);
  if (!session) return false;
  deviceMap.delete(deviceKey);
  cancelIdleTimer(session);
  // 关所有剩余 subscriber
  for (const sub of session.subscribers.values()) {
    if (!sub.closed) {
      sub.closed = true;
      try { sub.ws.close(1000, 'scrcpy session closed'); } catch { /* ignore */ }
    }
  }
  session.subscribers.clear();
  // cancel 共享 reader
  if (session.reader) {
    try { await session.reader.cancel(); } catch { /* ignore */ }
    session.reader = null;
  }
  // 关 client
  try {
    await session.client.close();
  } catch (e) {
    console.log(`[local-scrcpy] forceClose client close error deviceKey=${deviceKey}: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`[local-scrcpy] forceClose deviceKey=${deviceKey} serial=${serial}`);
  return true;
}

/**
 * 调试 / 30min 硬 GC 扫描:列出超过 SCRCPY_HARD_GC_MS 的设备(防止 idle 60s timer 因故没触发)。
 */
export function collectExpiredSharedScrcpySerials(): string[] {
  const now = Date.now();
  const expired: string[] = [];
  for (const s of deviceMap.values()) {
    if (now - s.startedAt > SCRCPY_HARD_GC_MS) expired.push(s.serial);
  }
  return expired;
}

export function activeSharedScrcpySessionCount(): number {
  return deviceMap.size;
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
