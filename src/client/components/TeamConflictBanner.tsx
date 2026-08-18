import { useEffect, useState } from 'react';
import { notification } from '../utils/notification';
import './TeamConflictBanner.css';

/**
 * Global optimistic-lock conflict banner. utils/api dispatches a
 * `team-conflict` CustomEvent on any 409 with data.conflict — this banner
 * surfaces it app-wide (no per-page wiring) and offers "load latest".
 */

interface ConflictDetail {
  message: string;
}

export default function TeamConflictBanner() {
  const [conflict, setConflict] = useState<ConflictDetail | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConflictDetail>).detail;
      setConflict(detail ?? { message: '资源已被他人修改' });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setConflict(null), 30_000);
    };
    window.addEventListener('team-conflict', handler);
    return () => {
      window.removeEventListener('team-conflict', handler);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!conflict) return null;

  return (
    <div className="tcb-banner" role="alert">
      <div className="tcb-banner-body">
        <span className="tcb-icon">⚠️</span>
        <span className="tcb-text">{conflict.message}</span>
        <div className="tcb-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setConflict(null);
              window.location.reload();
            }}
          >
            加载最新版本
          </button>
          <button className="btn btn-default btn-sm" onClick={() => setConflict(null)}>
            稍后处理
          </button>
        </div>
      </div>
    </div>
  );
}
