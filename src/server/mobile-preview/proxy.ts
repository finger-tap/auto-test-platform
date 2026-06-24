// 2026-06-08: 移动端预览会话管理 + 路由编排
//
// 状态:in-memory Map<sessionId, ActiveSession>。会话不持久化 — 用户关 drawer
// 立刻清理,server 重启后没人在意旧会话(用户从 UI 重连即可)。
//
// 一个 session = 一次执行绑定一台设备的一个 kind(screenshot / scrcpy / mjpeg)。
// 启动后 server 端持续拉帧推到客户端,关掉就停拉帧并清理 timer / fetcher。
//
// SSE 流:route handler 调 `streamSessionSse(sessionId, res)` 把内存里的
// Readable pipe 到 res;客户端 EventSource 订阅就行。
// WS 流:scrcpy 走 WebSocket 升级,server 在 connection handler 里
//   调 bridgeScrcpySession 拉到 mobile-agent 的 H.264 流。
//
// 2026-06-10: 共享 scrcpy 模型
//   - local scrcpy 走 device-keyed 共享(local-scrcpy.ts 的 SharedScrcpySession),
//     多个 preview sessionId 可挂同一台设备的同一个流。
//   - 这里 activeSessions 仍是 per-subscriber(UUID key),只存订阅关系 + serial 引用,
//     不再直接管 scrcpy 进程的生命周期(那是 local-scrcpy 的事)。
//   - 30 分钟硬 GC 改为扫 local-scrcpy 的 deviceMap(异常兜底),正常路径靠 60s 空闲回收。
//   - 远端 scrcpy 暂未共享(TODO:远端 agent 端实现 device-keyed 共享),仍 1:1。

import crypto from 'node:crypto';
import type { Response } from 'express';
import { getDevice } from '../db/devices.js';
import {
  makeAdbScreenshotFetcher,
  makeHdcScreenshotFetcher,
  makeWdaScreenshotFetcher,
  makeRemoteAgentScreenshotFetcher,
  makeScreenshotSseStream,
  type ScreenshotFetcher,
} from './screenshot-relay.js';
import { startPreview, stopPreview, recordFrame } from '../db/mobile-preview.js';
import type { PreviewKind } from '../db/mobile-preview.js';
import {
  getOrCreateSharedLocalScrcpy,
  collectExpiredSharedScrcpySerials,
  forceCloseSharedLocalScrcpy,
} from './local-scrcpy.js';
import { invalidateAllMergedCache } from '../devices/merge.js';

export interface StartPreviewInput {
  userId: number;
  /** 远端 devices.id;本地设备传 local 字符串 id(`local:android:<serial>`)时不需要 */
  deviceId: number | string;
  kind: PreviewKind;
  /** 可选 — 关联到 case execution(写 DB 审计行);不传则不写 */
  caseExecutionId?: number;
  /** 远端设备多机串号,UI 传过来;本地 id 已自带 serial,不需要 */
  serial?: string;
}

export interface StartPreviewResult {
  sessionId: string;
  kind: PreviewKind;
  /** 截图 / mjpeg 走 SSE 推;前端 EventSource('/api/mobile/preview/stream?sessionId=xxx') */
  ssePath?: string;
  /** scrcpy 走 WebSocket;前端 new WebSocket('/api/mobile/preview/ws?sessionId=xxx&token=...') */
  wsPath?: string;
  device: {
    name: string;
    platform: string;
    serial: string;
  };
}

/**
 * 2026-06-10: scrcpy session 描述 — discriminated union,跟 `ScrcpySource` 对齐。
 *   - local:  server 进程内已起好 scrcpy session(见 local-scrcpy.ts)
 *   - remote: 远端 mobile-agent 上跑的 scrcpy(走 HTTP / WS 中转)
 *
 * 2026-06-10: 给 remote 加 deviceId:number,merge.ts 用它快速 match 设备行,避免扫整个表。
 */
export type ScrcpySessionEntry =
  | { kind: 'local'; userId: number; serial: string; deviceKey: string; startedAt: number }
  | { kind: 'remote'; userId: number; serial: string; deviceId: number; agentBaseUrl: string; agentToken: string; startedAt: number };

interface ActiveScreenshotSession {
  id: string;
  userId: number;
  kind: 'screenshot' | 'mjpeg';
  fetcher: ScreenshotFetcher;
  caseExecutionId?: number;
  startedAt: number;
  /** SSE 拉帧间隔;mjpeg 200ms(5 FPS),screenshot 600ms(≈1.6 FPS) */
  intervalMs: number;
}

interface ActiveScrcpySession {
  id: string;
  userId: number;
  kind: 'scrcpy';
  scrcpy: ScrcpySessionEntry;
  caseExecutionId?: number;
  startedAt: number;
}

type ActiveSession = ActiveScreenshotSession | ActiveScrcpySession;

const activeSessions = new Map<string, ActiveSession>();

// 2026-06-10: 共享模型下,activeSessions 不再决定 scrcpy 进程生死(那是 local-scrcpy 的事,
// 60s 空闲 timer 自动回收)。这里只做 30min 硬 GC 兜底,扫 local-scrcpy deviceMap 中
// 异常长寿(>30min)的 session 强杀,防止 idle 60s timer 因故没触发。
// SSE 截图 session 单独走 30min 硬 GC(本地计时间,无 60s 软回收)。
const SSE_HARD_GC_MS = 30 * 60 * 1000;

function gcExpired(): void {
  // 1. local scrcpy 异常长寿
  const expiredSerials = collectExpiredSharedScrcpySerials();
  for (const s of expiredSerials) {
    console.log(`[preview:proxy] 30min hard GC local scrcpy serial=${s}`);
    void forceCloseSharedLocalScrcpy(s);
  }
  // 2. SSE 截图 session 30min 硬 GC
  const now = Date.now();
  for (const [id, s] of activeSessions) {
    if (s.kind !== 'scrcpy' && now - s.startedAt > SSE_HARD_GC_MS) {
      console.log(`[preview:proxy] 30min hard GC SSE session id=${id} age=${Math.round((now - s.startedAt) / 1000)}s`);
      stopSession(id);
    }
  }
}
setInterval(gcExpired, 60_000).unref();

/**
 * 解析 deviceId(可能是远端 devices.id,也可能是本地 `local:<platform>:<serial>` 字符串),
 * 返回 fetcher。kind='screenshot' / 'mjpeg' 时返回 fetcher;iOS 在 macOS + WDA 运行时才支持。
 *
 * 远端设备(2026-06-08):deviceId 是 number,设备行必须有 agent_endpoint(mobile-agent
 * 已注册),且调用方必须传 serial(同一台 mobile-agent 机器上可能接了多台手机)。
 * 走 `makeRemoteAgentScreenshotFetcher` HTTP POST 到 agent 的 /screencap。
 */
async function buildScreencapFetcher(
  deviceId: number | string,
  kind: 'screenshot' | 'mjpeg',
  serialHint: string | undefined,
): Promise<{
  fetcher: ScreenshotFetcher;
  deviceMeta: { name: string; platform: string; serial: string };
} | null> {
  // 本地设备 id 形式:`local:android:<serial>` / `local:harmony:<serial>` / `local:ios:<serial>`
  if (typeof deviceId === 'string' && deviceId.startsWith('local:')) {
    const [, platform, ...rest] = deviceId.split(':');
    const serial = rest.join(':');
    if (!platform || !serial) return null;
    let fetcher: ScreenshotFetcher | null = null;
    if (platform === 'android') fetcher = makeAdbScreenshotFetcher(serial);
    else if (platform === 'harmony') fetcher = makeHdcScreenshotFetcher(serial);
    else if (platform === 'ios') {
      // iOS 需要 WDA 跑起来;server 端约定 WDA 监听 8100
      if (process.platform !== 'darwin') return null;
      fetcher = makeWdaScreenshotFetcher(process.env.WDA_URL || 'http://127.0.0.1:8100');
    }
    if (!fetcher) return null;
    return { fetcher, deviceMeta: { name: serial, platform, serial } };
  }

  // 远端设备:数字 deviceId → 查 devices 表 → 拿 agent_endpoint + serial
  const numericId = typeof deviceId === 'number' ? deviceId : Number(deviceId);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const device = getDevice(numericId);
  if (!device) {
    console.log(`[preview:proxy] remote device id=${numericId} not found`);
    return null;
  }
  if (device.test_type !== 'mobile') {
    console.log(`[preview:proxy] device id=${numericId} test_type=${device.test_type} is not mobile`);
    return null;
  }
  if (!device.agent_endpoint) {
    console.log(`[preview:proxy] remote device id=${numericId} has no agent_endpoint (mobile-agent not registered)`);
    return null;
  }
  if (!serialHint) {
    console.log(`[preview:proxy] remote device id=${numericId} requires serial in request body`);
    return null;
  }
  return {
    fetcher: makeRemoteAgentScreenshotFetcher(device.agent_endpoint, serialHint),
    deviceMeta: { name: device.name, platform: 'android', serial: serialHint },
  };
}

/**
 * 2026-06-10: scrcpy session source discriminator。
 *   - 'local':  本地 Android,server 进程自己 adb + 推 scrcpy-server,见 local-scrcpy.ts
 *   - 'remote': 远端设备,server 经 HTTP/WS 调 mobile-agent(SSH 隧道过来)
 * 跟 ScrcpySessionEntry 形状对齐(只是少了 userId/startedAt/deviceKey)
 */
type ScrcpySource =
  | { kind: 'local'; serial: string }
  | { kind: 'remote'; serial: string; deviceId: number; agentBaseUrl: string; agentToken: string };

/**
 * 2026-06-10: 解析 scrcpy session 所需参数。
 *   - 本地 Android (deviceId=`local:android:<serial>`):server 自己 adb,直接 in-process 跑
 *   - 远端 mobile-agent (deviceId=number,设备行有 agent_endpoint):经 HTTP 调 agent
 */
function buildScrcpyEntry(
  deviceId: number | string,
  serialHint: string | undefined,
): { entry: ScrcpySource; deviceMeta: { name: string; platform: string; serial: string } } | null {
  // 本地 Android:serial 从 deviceId 解析,不再要求 caller 单独传
  if (typeof deviceId === 'string' && deviceId.startsWith('local:android:')) {
    const serial = deviceId.slice('local:android:'.length);
    if (!serial) return null;
    return {
      entry: { kind: 'local', serial },
      deviceMeta: { name: serial, platform: 'android', serial },
    };
  }
  // 远端:数字 deviceId → 查 devices 表 → 拿 agent_endpoint + serial
  const numericId = typeof deviceId === 'number' ? deviceId : Number(deviceId);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const device = getDevice(numericId);
  if (!device) {
    console.log(`[preview:proxy] scrcpy remote device id=${numericId} not found`);
    return null;
  }
  if (device.test_type !== 'mobile') {
    console.log(`[preview:proxy] scrcpy device id=${numericId} test_type=${device.test_type} is not mobile`);
    return null;
  }
  if (!device.agent_endpoint || !device.agent_token) {
    console.log(`[preview:proxy] scrcpy device id=${numericId} missing agent_endpoint/agent_token`);
    return null;
  }
  if (!serialHint) {
    console.log(`[preview:proxy] scrcpy device id=${numericId} requires serial in body`);
    return null;
  }
  return {
    entry: {
      kind: 'remote',
      serial: serialHint,
      deviceId: numericId,
      agentBaseUrl: device.agent_endpoint,
      agentToken: device.agent_token,
    },
    deviceMeta: { name: device.name, platform: 'android', serial: serialHint },
  };
}

export async function startPreviewSession(input: StartPreviewInput): Promise<StartPreviewResult | null> {
  const sessionId = crypto.randomUUID();
  if (input.kind === 'screenshot' || input.kind === 'mjpeg') {
    const built = await buildScreencapFetcher(input.deviceId, input.kind, input.serial);
    if (!built) return null;
    // mjpeg 走 5 FPS,screenshot 走 1.6 FPS(都是单帧 polling,
    // 真正的 multipart/x-mixed-replace MJPEG 留 wda-mjpeg shim)
    const intervalMs = input.kind === 'mjpeg' ? 200 : 600;
    const session: ActiveScreenshotSession = {
      id: sessionId,
      userId: input.userId,
      kind: input.kind,
      fetcher: built.fetcher,
      caseExecutionId: input.caseExecutionId,
      startedAt: Date.now(),
      intervalMs,
    };
    activeSessions.set(sessionId, session);
    if (input.caseExecutionId) {
      startPreview({ caseExecutionId: input.caseExecutionId, kind: input.kind, sessionId });
    }
    console.log(`[preview:proxy] start sessionId=${sessionId} user=${input.userId} device=${input.deviceId} kind=${input.kind} intervalMs=${intervalMs}`);
    return {
      sessionId,
      kind: input.kind,
      ssePath: `/api/mobile/preview/stream?sessionId=${sessionId}`,
      device: built.deviceMeta,
    };
  }
  if (input.kind === 'scrcpy') {
    const built = buildScrcpyEntry(input.deviceId, input.serial);
    if (!built) return null;
    // 2026-06-10: 共享模型 — local 走 getOrCreateSharedLocalScrcpy(幂等,已有则复用),
    // 真正的 scrcpy 进程生命周期由 local-scrcpy.ts 管理。这里只负责把订阅者挂上。
    if (built.entry.kind === 'local') {
      try {
        await getOrCreateSharedLocalScrcpy({ serial: built.entry.serial });
      } catch (e) {
        console.log(`[preview:proxy] shared local scrcpy getOrCreate failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
    const session: ActiveScrcpySession = {
      id: sessionId,
      userId: input.userId,
      kind: 'scrcpy',
      scrcpy: { ...built.entry, userId: input.userId, startedAt: Date.now() } as ScrcpySessionEntry,
      caseExecutionId: input.caseExecutionId,
      startedAt: Date.now(),
    };
    activeSessions.set(sessionId, session);
    if (input.caseExecutionId) {
      startPreview({ caseExecutionId: input.caseExecutionId, kind: input.kind, sessionId });
    }
    console.log(`[preview:proxy] start sessionId=${sessionId} user=${input.userId} device=${input.deviceId} kind=scrcpy source=${built.entry.kind}`);
    return {
      sessionId,
      kind: input.kind,
      // 前端用 ?token=<jwt> 升级 WS;auth 在 upgrade handler 里
      wsPath: `/api/mobile/preview/ws?sessionId=${sessionId}`,
      device: built.deviceMeta,
    };
  }
  return null;
}

export function stopSession(sessionId: string): boolean {
  const s = activeSessions.get(sessionId);
  if (!s) return false;
  activeSessions.delete(sessionId);
  // 2026-06-10: 共享模型下,这里只删 per-subscriber 状态;local scrcpy 进程
  // 由 local-scrcpy.ts 的 detachSharedScrcpySubscriber 减 viewer 数,viewer=0 启动 60s 回收。
  // 注意:本函数不会调 detach — 实际 detach 由 routes/mobile-preview.ts 的 WS close 触发
  // (客户端关 drawer → WS 断 → attachSharedScrcpySubscriber 内的 ws.on('close') 调 detach)。
  // 这里只是清理 proxy 自己的 per-session 元数据,跟共享 scrcpy 进程的解耦点。
  if (s.caseExecutionId) {
    stopPreview(s.caseExecutionId);
  }
  console.log(`[preview:proxy] stop sessionId=${sessionId} user=${s.userId} kind=${s.kind} scrcpySource=${s.kind === 'scrcpy' ? s.scrcpy.kind : 'n/a'}`);
  return true;
}

/**
 * 把指定 session 的帧流 pipe 到 HTTP res。Stream 自带 timer / fetcher 生命周期,
 * client 断开(res.close)时 stream 也会 close,定时器自动清理。
 * 只支持 screenshot / mjpeg;scrcpy 走 WebSocket,见 routes/mobile-preview.ts。
 */
export function streamSessionSse(sessionId: string, res: Response): boolean {
  const s = activeSessions.get(sessionId);
  if (!s) return false;
  if (s.kind === 'scrcpy') {
    console.log(`[preview:proxy] streamSessionSse called on scrcpy session ${sessionId} — use /ws instead`);
    return false;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // nginx 兼容

  const sseStream = makeScreenshotSseStream(s.fetcher, () => {
    if (s.caseExecutionId) {
      try { recordFrame(s.caseExecutionId); } catch { /* DB 写失败不影响流 */ }
    }
  }, s.intervalMs);
  sseStream.pipe(res);

  // client 断开 / 路由结束 → 停 stream(它内部会清 timer)
  res.on('close', () => {
    sseStream.destroy();
  });
  return true;
}

/** 给路由层判断 session 是否存在(比如防止 stream 连不存在的 sessionId) */
export function hasSession(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/** 调试用:列当前活跃 session 数 */
export function activeSessionCount(): number {
  return activeSessions.size;
}

/**
 * 给 scrcpy WS handler 拿 session 配置(agent URL + token + serial)。
 * 返回 null 表示 session 不存在或 kind 不对。
 */
export function getScrcpySessionDeps(sessionId: string): ScrcpySessionEntry | null {
  const s = activeSessions.get(sessionId);
  if (!s || s.kind !== 'scrcpy') return null;
  return s.scrcpy;
}

/**
 * 给 devices/merge.ts 用:扫 activeSessions 算某台远端设备的 scrcpy viewer 数。
 * 远端 scrcpy 1:1,所以返回 0 或 1。本地 scrcpy 走 local-scrcpy.ts 自己的 getViewerCount。
 *
 * Map.size 通常 ≤ 100,扫一遍可接受;若未来 viewer 数爆炸可加 per-deviceId 计数器缓存。
 */
export function getRemoteViewerCount(remoteDeviceId: number): number {
  let count = 0;
  for (const s of activeSessions.values()) {
    if (s.kind !== 'scrcpy') continue;
    if (s.scrcpy.kind !== 'remote') continue;
    if (s.scrcpy.deviceId === remoteDeviceId) count += 1;
  }
  return count;
}

export { invalidateAllMergedCache };
