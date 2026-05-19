import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEnvironment } from '../contexts/EnvironmentContext';
import HelpModal from './HelpModal';
import './Header.css';

interface HeaderProps {
  showSwitch?: boolean;
  onSwitchTestType?: () => void;
}

export default function Header({ showSwitch, onSwitchTestType }: HeaderProps) {
  const navigate = useNavigate();
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const envDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envDropRef.current && !envDropRef.current.contains(e.target as Node)) {
        setEnvOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);

    // Listen for env list changes (e.g., after switching default in env list page)
    const envChanged = () => { (window as any).__reloadEnvs?.(); };
    window.addEventListener('envs-changed', envChanged);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('envs-changed', envChanged);
    };
  }, []);

  return (
    <header className="hdr">
      <div className="hdr-left">
        <span className="hdr-logo" onClick={() => navigate('/')}>Auto Test Platform</span>
        {showSwitch && (
          <button className="hdr-switch" onClick={onSwitchTestType || (() => navigate('/'))}>切换测试类型</button>
        )}
      </div>
      <div className="hdr-right">
        {/* Environment switcher — only show when there are environments */}
        {environments.length > 0 && (
          <div className="hdr-env-switcher" ref={envDropRef}>
            <button className="hdr-env-btn" onClick={() => setEnvOpen(!envOpen)} style={{ color: activeEnv ? '#333' : '#999' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ marginRight: 4 }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              {activeEnv ? activeEnv.name : '选择环境'}
              <span style={{ fontSize: 10, marginLeft: 4 }}>▾</span>
            </button>
            {envOpen && (
              <div className="hdr-env-dropdown">
                {environments.map(env => (
                  <button
                    key={env.id}
                    className={`hdr-env-item ${activeEnv?.id === env.id ? 'active' : ''}`}
                    onClick={() => { setActiveEnv(env); setEnvOpen(false); }}
                  >
                    <span className="hdr-env-dot" />
                    <span>{env.name}</span>
                  </button>
                ))}
                <button
                  className={`hdr-env-item ${!activeEnv ? 'active' : ''}`}
                  style={{ color: '#999', borderTop: '1px solid #f0f0f0', marginTop: 4, paddingTop: 8 }}
                  onClick={() => { setActiveEnv(null); setEnvOpen(false); }}
                >
                  不使用环境
                </button>
              </div>
            )}
          </div>
        )}
        {/* Notification icon */}
        <button className="hdr-icon-btn" title="通知">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
          </svg>
        </button>
        {/* Help icon — opens built-in function reference */}
        <button className="hdr-icon-btn" title="帮助" onClick={() => setHelpOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
          </svg>
        </button>
        {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      </div>
    </header>
  );
}