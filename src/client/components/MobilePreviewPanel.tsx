// 2026-06-11: 移动端预览面板 — 纯内容组件(无 drawer 包装)
//
// 从 MobilePreviewDrawer 提取,用于并排布局场景:
//   - screenshot / mjpeg: <img> + SSE 帧流
//   - scrcpy:            WebSocket H.264 + WebCodecs canvas
//
// 父组件负责 hook 调用(usePreviewSession / useScrcpyDecoder),本组件只做渲染。

import type { RefObject } from 'react';
import type { PreviewKind } from '../types';
import type { SseFrameEvent, ScrcpyEvent } from '../hooks/usePreviewSession';
import type { ScrcpyMetadata } from '../hooks/useScrcpyDecoder';
import './MobilePreviewPanel.css';

export interface MobilePreviewPanelProps {
  kind: PreviewKind;
  deviceName: string;
  platform: string;
  serial?: string;
  /** preview session 状态 */
  sessionState: 'idle' | 'starting' | 'streaming' | 'error';
  sessionError?: string;
  pendingExecute?: boolean;
  /** SSE/screenshot 帧回调注册 */
  onFrame?: (cb: (e: SseFrameEvent) => void) => void;
  /** scrcpy 事件回调注册 */
  onScrcpyEvent?: (cb: (e: ScrcpyEvent) => void) => void;
  /** scrcpy decoder state */
  scrcpyState: { kind: 'idle' | 'ready' | 'error'; metadata?: ScrcpyMetadata; message?: string };
  scrcpyStatus: 'idle' | 'open' | 'closed' | 'error';
  scrcpyMetadata: ScrcpyMetadata | null;
  scrcpyRenderedFrames: number;
  scrcpyDroppedFrames: number;
  scrcpyError: string | null;
  frameCount: number;
  /** DOM refs */
  imgRef: RefObject<HTMLImageElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  onClose: () => void;
}

export default function MobilePreviewPanel(props: MobilePreviewPanelProps) {
  const {
    kind, deviceName, platform, serial,
    sessionState, sessionError, pendingExecute,
    scrcpyState, scrcpyStatus, scrcpyMetadata,
    scrcpyRenderedFrames, scrcpyDroppedFrames, scrcpyError,
    frameCount, imgRef, canvasRef, onClose,
  } = props;

  return (
    <div className="mpp">
      <div className="mpp-header">
        <div className="mpp-title">
          <div className="mpp-device-name">{deviceName}</div>
          <div className="mpp-meta">
            {platform} · {kind}
            {serial ? ` · ${serial}` : ''}
          </div>
        </div>
        <div className="mpp-header-right">
          {kind === 'scrcpy' && (
            <span className="mpp-hint">关闭后 60 秒内无其他用户查看将自动释放</span>
          )}
          <button className="mpp-close" onClick={onClose} aria-label="关闭预览">×</button>
        </div>
      </div>

      <div className="mpp-body">
        {sessionState === 'idle' || sessionState === 'starting' ? (
          <div className="mpp-status">
            <div className="mpp-status-spinner" />
            <div>{pendingExecute ? '正在连接屏幕，连接成功后自动开始执行...' : '正在连接屏幕...'}</div>
          </div>
        ) : sessionState === 'error' ? (
          <div className="mpp-error">
            <div className="mpp-error-title">预览启动失败</div>
            <div className="mpp-error-msg">{sessionError}</div>
          </div>
        ) : (
          <div className="mpp-stream">
            {kind === 'screenshot' || kind === 'mjpeg' ? (
              <img
                ref={imgRef}
                className="mpp-screen"
                alt="设备屏幕实时画面"
              />
            ) : (
              <ScrcpyPanel
                canvasRef={canvasRef}
                metadata={scrcpyMetadata}
                decoderState={scrcpyState}
                status={scrcpyStatus}
                renderedFrames={scrcpyRenderedFrames}
                droppedFrames={scrcpyDroppedFrames}
                decoderError={scrcpyError}
              />
            )}
          </div>
        )}
      </div>

      <div className="mpp-footer">
        <span className="mpp-stat">帧数: {frameCount}</span>
        {kind === 'scrcpy' && scrcpyState.kind === 'ready' && (
          <span className="mpp-stat">渲染: {scrcpyRenderedFrames} · 丢帧: {scrcpyDroppedFrames}</span>
        )}
      </div>
    </div>
  );
}

interface ScrcpyPanelProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  metadata: ScrcpyMetadata | null;
  decoderState: { kind: 'idle' | 'ready' | 'error'; metadata?: ScrcpyMetadata; message?: string };
  status: 'idle' | 'open' | 'closed' | 'error';
  renderedFrames: number;
  droppedFrames: number;
  decoderError: string | null;
}

function ScrcpyPanel({
  canvasRef, metadata, decoderState, status,
  renderedFrames, droppedFrames, decoderError,
}: ScrcpyPanelProps) {
  return (
    <div className="mpp-scrcpy">
      <canvas
        ref={canvasRef}
        className="mpp-scrcpy-canvas"
        width={metadata?.width ?? 1080}
        height={metadata?.height ?? 1920}
      />
      {decoderState.kind === 'idle' && (
        <div className="mpp-scrcpy-overlay">
          {status === 'open' ? '等待元数据...' : `连接状态: ${statusLabel(status)}`}
        </div>
      )}
      {decoderState.kind === 'error' && (
        <div className="mpp-scrcpy-overlay mpp-scrcpy-overlay-err">
          {decoderState.message || decoderError || '解码器错误'}
        </div>
      )}
      {decoderState.kind === 'ready' && (
        <div className="mpp-scrcpy-stats">
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
