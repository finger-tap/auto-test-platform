import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEnvironment } from '../contexts/EnvironmentContext';
import SettingsDrawer from './SettingsDrawer';
import type { Environment } from '../types';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  return { theme, toggle };
}

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
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayName = user?.nickname || user?.account?.slice(0, 8) || 'User';
  const firstChar = displayName.charAt(0).toUpperCase();
  const avatarSrc = user?.avatar && !user.avatar.startsWith('data:') ? user.avatar : null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
        <div className="hdr-user-menu" ref={userMenuRef}>
          <button className="hdr-user-btn" onClick={() => setUserMenuOpen(o => !o)}>
            <div className="hdr-user-avatar">
              {avatarSrc ? <img src={avatarSrc} alt="" /> : firstChar}
            </div>
            <span className="hdr-user-name">{displayName}</span>
            <span className="hdr-user-arrow">▾</span>
          </button>
          {userMenuOpen && (
            <div className="hdr-user-dropdown">
              <div className="hdr-user-dropdown-info">
                <div className="hdr-user-dropdown-name">{displayName}</div>
                <div className="hdr-user-dropdown-account">{user?.account || ''}</div>
              </div>
              <div className="hdr-user-dropdown-divider" />
              <button className="hdr-user-dropdown-item" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}>
                账号与设置
              </button>
              <div className="hdr-user-dropdown-divider" />
              <button className="hdr-user-dropdown-item danger" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
