// 2026-06-09: 移动端执行预览抽屉
//
// 右侧 360-400px 滑出抽屉,展示所选设备的实时屏幕。三种 kind:
//   - screenshot / mjpeg: <img> + SSE 帧流,每帧 base64 替换 src
//   - scrcpy:            WebSocket 二进制 H.264,WebCodecs VideoDecoder + WebGL canvas
//                        (30 FPS 实时画面,跟 mobile-agent 端对齐)
//
// 顶部固定 header(设备名 + 状态 + 关),内容区根据 kind 渲染,底部状态栏显示帧数 / 错误。
// 关 drawer 按钮调父组件传入的 onClose,父组件负责 stop preview session。

import { useEffect, useRef, useState } from 'react';
import type { PreviewKind } from '../types';
import { usePreviewSession, type SseFrameEvent, type ScrcpyEvent } from '../hooks/usePreviewSession';
import { useScrcpyDecoder, type ScrcpyMetadata } from '../hooks/useScrcpyDecoder';
import './MobilePreviewDrawer.css';

export interface MobilePreviewDrawerProps {
  open: boolean;
  deviceId: number | string;
  deviceName: string;
  platform: string;
  serial?: string;
  kind: PreviewKind;
  caseExecutionId?: number;
  onClose: () => void;
  /** 父组件监听预览 session 状态变化 */
  onSessionStateChange?: (state: 'idle' | 'starting' | 'streaming' | 'error') => void;
  /** true = 屏幕连上后会自动执行用例 */
  pendingExecute?: boolean;
}

export default function MobilePreviewDrawer(props: MobilePreviewDrawerProps) {
  const { open, deviceId, deviceName, platform, serial, kind, caseExecutionId, onClose, onSessionStateChange, pendingExecute } = props;
  // 抽屉关时,enabled=false 让 hook 走 cleanup
  const session = usePreviewSession({
    deviceId,
    serial,
    kind,
    caseExecutionId,
    enabled: open,
  });

  // 同步 session state 到父组件
  useEffect(() => {
    onSessionStateChange?.(session.state.kind);
  }, [session.state.kind, onSessionStateChange]);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [scrcpyStatus, setScrcpyStatus] = useState<'idle' | 'open' | 'closed' | 'error'>('idle');
  const [scrcpyMetadata, setScrcpyMetadata] = useState<ScrcpyMetadata | null>(null);
  const [scrcpyError, setScrcpyError] = useState<string | null>(null);

  // 订阅 SSE 帧:base64 塞 <img src="data:image/png;base64,...">
  // 2026-06-10: server screencap -p 输出的是 PNG 字节(不是 JPEG),MIME 必须配 png,
  // 之前写 image/jpeg 导致浏览器解码失败、img 是空的。
  useEffect(() => {
    if (kind !== 'screenshot' && kind !== 'mjpeg') return;
    session.onFrame?.((e: SseFrameEvent) => {
      const src = `data:image/png;base64,${e.image}`;
      if (imgRef.current) {
        imgRef.current.src = src;
      }
      setFrameCount((c) => c + 1);
    });
  }, [kind, session]);

  // scrcpy decoder:把 WebCodecs 渲染到 canvas。decoder 拿到 metadata 才初始化,
  // 拿到 metadata 之前 metadata=null → 内部 effect 跳过,canvas 是空白。
  const scrcpy = useScrcpyDecoder({
    canvas: kind === 'scrcpy' ? canvasRef.current : null,
    metadata: scrcpyMetadata,
  });

  // 订阅 scrcpy 事件(从 usePreviewSession 转出来的)
  useEffect(() => {
    if (kind !== 'scrcpy') return;
    session.onScrcpyEvent?.((e: ScrcpyEvent) => {
      if (e.type === 'open') setScrcpyStatus('open');
      else if (e.type === 'close') setScrcpyStatus('closed');
      else if (e.type === 'error') {
        setScrcpyStatus('error');
        setScrcpyError(e.message);
      } else if (e.type === 'metadata') {
        setScrcpyError(null);
        setScrcpyMetadata(e.metadata);
      } else if (e.type === 'frame') {
        scrcpy.push(e.bytes);
        setFrameCount((c) => c + 1);
      }
    });
  }, [kind, session, scrcpy]);

  // 关 drawer 时,清掉自己的统计 + decoder state
  useEffect(() => {
    if (!open) {
      setFrameCount(0);
      setScrcpyStatus('idle');
      setScrcpyMetadata(null);
      setScrcpyError(null);
      if (imgRef.current) imgRef.current.src = '';
    }
  }, [open]);

  return (
    <div className={`mpd-mask ${open ? 'open' : ''}`} onClick={onClose}>
      <aside
        className={`mpd-drawer ${open ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="complementary"
        aria-label="实时屏幕预览"
      >
        <div className="mpd-header">
          <div className="mpd-title">
            <div className="mpd-device-name">{deviceName}</div>
            <div className="mpd-meta">
              {platform} · {kind}
              {serial ? ` · ${serial}` : ''}
            </div>
          </div>
          <div className="mpd-header-right">
            {/* 2026-06-10: 提示文案 — 关 drawer 不会立刻释放 scrcpy,server 端 60s 空闲 timer 自动回收 */}
            {kind === 'scrcpy' && (
              <span className="mpd-hint">关闭后 60 秒内无其他用户查看将自动释放</span>
            )}
            <button className="mpd-close" onClick={onClose} aria-label="关闭预览">×</button>
          </div>
        </div>

        <div className="mpd-body">
          {session.state.kind === 'idle' || session.state.kind === 'starting' ? (
            <div className="mpd-status">
              <div className="mpd-status-spinner" />
              <div>{pendingExecute ? '正在连接屏幕，连接成功后自动开始执行...' : '正在连接屏幕...'}</div>
            </div>
          ) : session.state.kind === 'error' ? (
            <div className="mpd-error">
              <div className="mpd-error-title">预览启动失败</div>
              <div className="mpd-error-msg">{session.state.message}</div>
            </div>
          ) : (
            <div className="mpd-stream">
              {kind === 'screenshot' || kind === 'mjpeg' ? (
                <img
                  ref={imgRef}
                  className="mpd-screen"
                  alt="设备屏幕实时画面"
                />
              ) : (
                <ScrcpyPanel
                  canvasRef={canvasRef}
                  metadata={scrcpyMetadata}
                  decoderState={scrcpy.state}
                  status={scrcpyStatus}
                  renderedFrames={scrcpy.renderedFrames}
                  droppedFrames={scrcpy.droppedFrames}
                  decoderError={scrcpyError}
                />
              )}
            </div>
          )}
        </div>

        <div className="mpd-footer">
          <span className="mpd-stat">帧数: {frameCount}</span>
          {kind === 'scrcpy' && scrcpy.state.kind === 'ready' && (
            <span className="mpd-stat">渲染: {scrcpy.renderedFrames} · 丢帧: {scrcpy.droppedFrames}</span>
          )}
          {session.state.kind === 'streaming' && session.state.lastError && (
            <span className="mpd-stat mpd-stat-warn">{session.state.lastError}</span>
          )}
        </div>
      </aside>
    </div>
  );
}

interface ScrcpyPanelProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  metadata: ScrcpyMetadata | null;
  decoderState: { kind: 'idle' | 'ready' | 'error'; metadata?: ScrcpyMetadata; message?: string };
  status: 'idle' | 'open' | 'closed' | 'error';
  renderedFrames: number;
  droppedFrames: number;
  decoderError: string | null;
}

function ScrcpyPanel({
  canvasRef,
  metadata,
  decoderState,
  status,
  renderedFrames,
  droppedFrames,
  decoderError,
}: ScrcpyPanelProps) {
  return (
    <div className="mpd-scrcpy">
      <canvas
        ref={canvasRef}
        className="mpd-scrcpy-canvas"
        width={metadata?.width ?? 1080}
        height={metadata?.height ?? 1920}
      />
      {decoderState.kind === 'idle' && (
        <div className="mpd-scrcpy-overlay">
          {status === 'open' ? '等待元数据...' : `连接状态: ${statusLabel(status)}`}
        </div>
      )}
      {decoderState.kind === 'error' && (
        <div className="mpd-scrcpy-overlay mpd-scrcpy-overlay-err">
          {decoderState.message || decoderError || '解码器错误'}
        </div>
      )}
      {decoderState.kind === 'ready' && (
        <div className="mpd-scrcpy-stats">
          <div>已渲染: <b>{renderedFrames}</b></div>
          <div>丢帧: <b>{droppedFrames}</b></div>
        </div>
      )}
    </div>
  );
}

function statusLabel(s: 'idle' | 'open' | 'closed' | 'error'): string {
  if (s === 'open') return '已连接';
  if (s === 'closed') return '已断开';
  if (s === 'error') return '错误';
  return '未连接';
}
