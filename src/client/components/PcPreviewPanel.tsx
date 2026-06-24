// PC preview panel — desktop screenshot stream via SSE.
//
// Shows the server's desktop in real-time during PC test execution.
// Uses the same SSE frame protocol as mobile screenshot preview.

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch, getToken } from '../utils/api';
import './MobilePreviewPanel.css'; // reuse mobile panel styles

interface PcPreviewPanelProps {
  /** 关闭预览面板 */
  onClose: () => void;
}

type SessionState = 'idle' | 'starting' | 'streaming' | 'error';

export default function PcPreviewPanel({ onClose }: PcPreviewPanelProps) {
  const [state, setState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ssePath, setSsePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const frameCountRef = useRef(0);

  // Start preview session
  useEffect(() => {
    let cancelled = false;
    setState('starting');
    (async () => {
      try {
        const res = await apiFetch<{ sessionId: string; ssePath: string }>(
          '/pc/preview/start',
          { method: 'POST' },
        );
        if (cancelled) return;
        if (res.code !== 200 || !res.data) {
          setState('error');
          setError(res.message || '启动预览失败');
          return;
        }
        setSessionId(res.data.sessionId);
        setSsePath(res.data.ssePath);
      } catch (e) {
        if (cancelled) return;
        setState('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to SSE when ssePath is available
  useEffect(() => {
    if (!ssePath) return;
    const token = getToken();
    if (!token) {
      setState('error');
      setError('缺少 token');
      return;
    }
    const sep = ssePath.includes('?') ? '&' : '?';
    const url = `${ssePath}${sep}token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('ready', () => {
      setState('streaming');
    });
    es.addEventListener('frame', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { ts: number; image: string };
        if (imgRef.current) {
          imgRef.current.src = `data:image/png;base64,${data.image}`;
        }
        frameCountRef.current += 1;
        if (frameCountRef.current % 5 === 0) {
          setFrameCount(frameCountRef.current);
        }
      } catch { /* ignore */ }
    });
    es.addEventListener('noop', () => {
      // screenshot failed this tick, keep waiting
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setState('error');
        setError('SSE 连接已关闭');
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [ssePath]);

  // Stop session on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        apiFetch('/pc/preview/stop', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        }).catch(() => {});
      }
    };
  }, [sessionId]);

  const handleClose = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (sessionId) {
      apiFetch('/pc/preview/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    onClose();
  }, [sessionId, onClose]);

  return (
    <div className="mpp">
      <div className="mpp-header">
        <div className="mpp-title">
          <div className="mpp-device-name">桌面实时预览</div>
          <div className="mpp-meta">PC · screenshot</div>
        </div>
        <div className="mpp-header-right">
          <button className="mpp-close" onClick={handleClose} aria-label="关闭预览">×</button>
        </div>
      </div>

      <div className="mpp-body">
        {state === 'idle' || state === 'starting' ? (
          <div className="mpp-status">
            <div className="mpp-status-spinner" />
            <div>正在连接桌面...</div>
          </div>
        ) : state === 'error' ? (
          <div className="mpp-error">
            <div className="mpp-error-title">预览启动失败</div>
            <div className="mpp-error-msg">{error}</div>
          </div>
        ) : (
          <div className="mpp-stream">
            <img
              ref={imgRef}
              className="mpp-screen"
              alt="桌面实时画面"
            />
          </div>
        )}
      </div>

      <div className="mpp-footer">
        <span className="mpp-stat">帧数: {frameCount}</span>
      </div>
    </div>
  );
}
