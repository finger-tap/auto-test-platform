import { useState, useRef, useEffect } from 'react';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { useThemeContext } from '../contexts/ThemeContext';
import UserMenu from './UserMenu';
import type { Environment } from '../types';

/**
 * Shared top header: 返回主页 + 环境切换 + 用户菜单.
 * Used by both the test-type Layout and the SettingsLayout so that
 * the environment switcher, user menu, and logout flow stay consistent
 * across the app.
 *
 * The user menu exposes a single "账号与设置" entry that lands on
 * /settings — the per-user profile / change-password pages now live
 * there, not in the dropdown.
 */
export default function SysHeader() {
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useThemeContext();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="sys-header">
      <div className="sys-header-right">
        <button className="hdr-theme-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色' : '切换暗色'}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
        {environments && environments.length > 0 && (
          <div className="hdr-env-switcher" ref={envRef}>
            <button className="hdr-env-btn" onClick={() => setEnvOpen(!envOpen)}>
              <span className="hdr-env-dot" />
              {activeEnv ? activeEnv.name : '选择环境'}
              <span className="hdr-env-arrow">▾</span>
            </button>
            {envOpen && (
              <div className="hdr-env-dropdown">
                {environments.map((env: Environment) => (
                  <button
                    key={env.id}
                    className={`hdr-env-item ${activeEnv?.id === env.id ? 'active' : ''}`}
                    onClick={() => { setActiveEnv(env); setEnvOpen(false); }}
                  >
                    <span className="hdr-env-dot" />
                    <span>{env.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <UserMenu />
      </div>
    </div>
  );
}
