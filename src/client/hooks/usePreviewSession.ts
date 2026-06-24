// 2026-06-09: 移动端预览会话生命周期 hook
//
// 三个 kind:
//   - screenshot: SSE 帧流 (text/event-stream),事件 `frame` / `noop` / `ready`
//   - mjpeg:      SSE 帧流(同 screenshot 但 5 FPS),复用同一 EventSource
//   - scrcpy:     WebSocket 二进制(H.264 元数据 + 帧),前端需要 WebCodecs 解码
//
// start 调 POST /api/mobile/preview/start 拿 sessionId + 路径
// stop  调 POST /api/mobile/preview/stop
// 关闭组件或 unmount 时自动 stop

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getToken } from '../utils/api';
import type { PreviewSession, PreviewKind } from '../types';

export interface UsePreviewSessionInput {
  /** 后端代理的 device id(本地=local:<platform>:<serial>,远端=number) */
  deviceId: number | string;
  /** 远端 mobile-agent 机器上的串号 */
  serial?: string;
  kind: PreviewKind;
  /** 关联到 case execution,DB 写审计 */
  caseExecutionId?: number;
  /** 启用后才真正发请求 — 避免父组件没准备好时立刻订阅 */
  enabled: boolean;
}

export interface SseFrameEvent {
  ts: number;
  image: string;        // base64
}

export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'streaming'; session: PreviewSession; frames: number; lastError: string | null }
  | { kind: 'error'; message: string };

export interface UsePreviewSessionReturn {
  state: PreviewState;
  /** SSE kind 时调用,接 EventSource 'frame' / 'noop' 事件 */
  onFrame?: (cb: (e: SseFrameEvent) => void) => void;
  /** scrcpy kind 时调用,接 WebSocket open / close / message (binary) */
  onScrcpyEvent?: (cb: (e: ScrcpyEvent) => void) => void;
  /** 手动关 session(关 drawer 时调,server 立即停拉帧) */
  stop: () => Promise<void>;
}

export type ScrcpyEvent =
  | { type: 'open' }
  | { type: 'metadata'; metadata: { codec: number; width: number; height: number; serial: string } }
  | { type: 'frame'; bytes: ArrayBuffer }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error'; message: string };

export function usePreviewSession(input: UsePreviewSessionInput): UsePreviewSessionReturn {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });
  const sessionRef = useRef<PreviewSession | null>(null);
  const framesRef = useRef(0);
  const sseSourceRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCbRef = useRef<((e: SseFrameEvent) => void) | null>(null);
  const scrcpyCbRef = useRef<((e: ScrcpyEvent) => void) | null>(null);

  const stop = useCallback(async () => {
    const sess = sessionRef.current;
    if (sseSourceRef.current) {
      sseSourceRef.current.close();
      sseSourceRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    sessionRef.current = null;
    framesRef.current = 0;
    if (sess) {
      try {
        await apiFetch(`/mobile/preview/stop`, {
          method: 'POST',
          body: JSON.stringify({ sessionId: sess.sessionId }),
        });
      } catch (e) {
        console.log(`[use-preview] stop failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setState({ kind: 'idle' });
  }, []);

  // 启停 effect
  useEffect(() => {
    if (!input.enabled) {
      // 关掉一切并清状态
      void stop();
      return;
    }
    let cancelled = false;
    setState({ kind: 'starting' });
    const startTs = Date.now();
    (async () => {
      try {
        const res = await apiFetch<PreviewSession>(`/mobile/preview/start`, {
          method: 'POST',
          body: JSON.stringify({
            deviceId: input.deviceId,
            serial: input.serial,
            kind: input.kind,
            caseExecutionId: input.caseExecutionId,
          }),
        });
        if (cancelled) return;
        if (res.code !== 200 || !res.data) {
          setState({ kind: 'error', message: res.message || '启动预览失败' });
          return;
        }
        const sess = res.data;
        sessionRef.current = sess;
        framesRef.current = 0;
        console.log(`[use-preview] started sessionId=${sess.sessionId} kind=${sess.kind} device=${sess.device.name} cost=${Date.now() - startTs}ms`);
        if (sess.kind === 'screenshot' || sess.kind === 'mjpeg') {
          // 2026-06-10: SSE 不能带 Authorization header,token 走 ?token= query,
          // 跟 server 的 sseTokenQueryFallback 配套。state 等 'ready' 事件才切 streaming,
          // 这样 401 / 404 / 设备掉线会清楚走到 error 而不是停在'启动中...'。
          attachSse(sess.ssePath!);
        } else if (sess.kind === 'scrcpy') {
          attachScrcpyWs(sess.wsPath!);
          setState({ kind: 'streaming', session: sess, frames: 0, lastError: null });
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[use-preview] start failed: ${msg}`);
        setState({ kind: 'error', message: msg });
      }
    })();
    return () => {
      cancelled = true;
      // unmount / deps 变化时清理
      if (sseSourceRef.current) {
        sseSourceRef.current.close();
        sseSourceRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      const sess = sessionRef.current;
      sessionRef.current = null;
      if (sess) {
        apiFetch(`/mobile/preview/stop`, {
          method: 'POST',
          body: JSON.stringify({ sessionId: sess.sessionId }),
        }).catch(() => {});
      }
    };
    // 2026-06-11: caseExecutionId removed from deps — it changes from null → number
    // when /execute returns, which would tear down the scrcpy WebSocket and restart
    // the session. The preview should stay alive until the user closes the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.enabled, input.deviceId, input.serial, input.kind]);

  const attachSse = (path: string) => {
    // 2026-06-10: EventSource 不支持 Authorization header,token 走 query —
    // server /stream 在 authMiddleware 后面挂了 sseTokenQueryFallback,
    // 从 ?token= 读 JWT 校验。WebSocket 升级那边已经用同样模式。
    const token = getToken();
    if (!token) {
      setState({ kind: 'error', message: '缺少 token,无法订阅屏幕流' });
      return;
    }
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `${path}${sep}token=${encodeURIComponent(token)}`;
    const es = new EventSource(fullPath, { withCredentials: false });
    sseSourceRef.current = es;
    es.addEventListener('ready', () => {
      console.log(`[use-preview] SSE ready ${path}`);
      const sess = sessionRef.current;
      if (sess) setState({ kind: 'streaming', session: sess, frames: 0, lastError: null });
    });
    es.addEventListener('frame', (ev) => {
      framesRef.current += 1;
      try {
        const data = JSON.parse((ev as MessageEvent).data) as SseFrameEvent;
        frameCbRef.current?.(data);
        // 偶发更新一下 frames 计数(给 UI 显示)
        if (framesRef.current % 10 === 0 && sessionRef.current) {
          setState((s) => s.kind === 'streaming'
            ? { ...s, frames: framesRef.current, lastError: null }
            : s);
        }
      } catch (e) {
        console.log(`[use-preview] frame parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    es.addEventListener('noop', () => {
      // 拉帧失败,sse 仍然活着,不报错
    });
    es.onerror = () => {
      // EventSource 不会自动恢复时,设置 lastError。
      // 关键:ready 之前就 CLOSED(典型 401/404)→ 整个切到 error,不要停在 streaming。
      console.log(`[use-preview] SSE error path=${path} readyState=${es.readyState}`);
      if (es.readyState === EventSource.CLOSED) {
        setState((s) => {
          if (s.kind === 'streaming') return { ...s, lastError: 'SSE 连接已关闭' };
          // 还没 ready 就 close → 整体是 error(典型 401 / 404 / 设备下线)
          return { kind: 'error', message: 'SSE 连接失败(401/404/设备已离线),请检查 token 或重试' };
        });
      }
    };
  };

  const attachScrcpyWs = (path: string) => {
    const token = getToken();
    if (!token) {
      setState({ kind: 'error', message: '缺少 token,无法连接 WebSocket' });
      return;
    }
    // scrcpy 走 native WebSocket(浏览器原生的)— 二进制 H.264
    const url = `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    // http -> ws / https -> wss
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${url}`;
    console.log(`[use-preview] opening scrcpy WS ${wsUrl.replace(token, '<token>')}`);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onopen = () => {
      console.log(`[use-preview] scrcpy WS open`);
      scrcpyCbRef.current?.({ type: 'open' });
    };
    ws.onmessage = (ev) => {
      framesRef.current += 1;
      const data = ev.data;
      if (typeof data === 'string') {
        // 首条 text 消息:JSON metadata。解析后给 decoder 用,失败就当 error。
        try {
          const json = JSON.parse(data) as { type?: string; codec?: number; width?: number; height?: number; serial?: string };
          if (json && json.type === 'metadata' && typeof json.codec === 'number'
              && typeof json.width === 'number' && typeof json.height === 'number') {
            console.log(`[use-preview] scrcpy metadata codec=${json.codec} ${json.width}x${json.height}`);
            scrcpyCbRef.current?.({
              type: 'metadata',
              metadata: {
                codec: json.codec,
                width: json.width,
                height: json.height,
                serial: json.serial ?? '',
              },
            });
          }
        } catch (e) {
          console.log(`[use-preview] scrcpy metadata parse error: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (data instanceof ArrayBuffer) {
        // binary 帧(1 byte type + payload),直接给 decoder
        scrcpyCbRef.current?.({ type: 'frame', bytes: data });
      }
    };
    ws.onclose = (ev) => {
      console.log(`[use-preview] scrcpy WS close code=${ev.code} reason=${ev.reason}`);
      scrcpyCbRef.current?.({ type: 'close', code: ev.code, reason: ev.reason });
    };
    ws.onerror = (ev) => {
      console.log(`[use-preview] scrcpy WS error: ${(ev as Event).type}`);
      scrcpyCbRef.current?.({ type: 'error', message: 'WebSocket 错误' });
    };
  };

  const onFrame = useCallback((cb: (e: SseFrameEvent) => void) => {
    frameCbRef.current = cb;
  }, []);

  const onScrcpyEvent = useCallback((cb: (e: ScrcpyEvent) => void) => {
    scrcpyCbRef.current = cb;
  }, []);

  return { state, onFrame, onScrcpyEvent, stop };
}
