import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnvironment } from '../contexts/EnvironmentContext';
import './Layout.css';

// SVG icons for nav items
const icons: Record<string, React.ReactNode> = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  doc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>,
  folder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  report: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  env: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9"/></svg>,
  tag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1"/></svg>,
  mobile: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>,
  lightning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  globe: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
  monitor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
};

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

const MENUS_BY_TYPE: Record<string, NavSection[]> = {
  'api-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/api-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/api-test/api-case', icon: 'doc' }] },
    { section: '场景编排', items: [
      { label: '场景列表', path: '/api-test/scene-case', icon: 'check' },
      { label: '场景集', path: '/api-test/scene-set', icon: 'folder' },
    ]},
    { section: '执行管理', items: [
      { label: '定时任务', path: '/api-test/schedule', icon: 'clock' },
    ]},
    { section: '辅助功能', items: [
      { label: 'Mock 服务', path: '/api-test/mock', icon: 'chat' },
      { label: '环境管理', path: '/api-test/environment', icon: 'env' },
      { label: '标签管理', path: '/api-test/system-config', icon: 'tag' },
    ]},
  ],
  'mobile-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/mobile-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/mobile-test/test-case', icon: 'mobile' }] },
    { section: '场景编排', items: [
      { label: '场景列表', path: '/mobile-test/scene-case', icon: 'check' },
      { label: '案例集', path: '/mobile-test/scene-set', icon: 'folder' },
    ]},
    { section: '执行管理', items: [
      { label: '定时任务', path: '/mobile-test/schedule', icon: 'clock' },
    ]},
    { section: '辅助功能', items: [
      { label: 'Mock 服务', path: '/mobile-test/mock', icon: 'chat' },
      { label: '环境管理', path: '/mobile-test/environment', icon: 'env' },
      { label: '标签管理', path: '/mobile-test/system-config', icon: 'tag' },
    ]},
  ],
  'web-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/web-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/web-test/case', icon: 'doc' }] },
    { section: '场景编排', items: [
      { label: '场景列表', path: '/web-test/scene', icon: 'check' },
      { label: '场景集', path: '/web-test/scene-set', icon: 'folder' },
    ]},
    { section: '执行管理', items: [
      { label: '定时任务', path: '/web-test/schedule', icon: 'clock' },
    ]},
    { section: '辅助功能', items: [
      { label: '环境管理', path: '/web-test/environment', icon: 'env' },
      { label: '标签管理', path: '/web-test/system-config', icon: 'tag' },
    ]},
  ],
  'pc-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/pc-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/pc-test/case', icon: 'doc' }] },
    { section: '场景编排', items: [
      { label: '场景列表', path: '/pc-test/scene', icon: 'check' },
      { label: '场景集', path: '/pc-test/scene-set', icon: 'folder' },
    ]},
    { section: '执行管理', items: [
      { label: '定时任务', path: '/pc-test/schedule', icon: 'clock' },
    ]},
    { section: '辅助功能', items: [
      { label: '环境管理', path: '/pc-test/environment', icon: 'env' },
      { label: '标签管理', path: '/pc-test/system-config', icon: 'tag' },
    ]},
  ],
};

const BRAND_CONFIG: Record<string, { name: string; color: string; icon: string }> = {
  'api-test': { name: '接口测试', color: 'oklch(95% 0.04 250)', icon: 'lightning' },
  'mobile-test': { name: '移动端测试', color: 'oklch(95% 0.04 75)', icon: 'mobile' },
  'web-test': { name: 'Web 测试', color: 'oklch(95% 0.04 145)', icon: 'globe' },
  'pc-test': { name: 'PC 测试', color: 'oklch(95% 0.04 300)', icon: 'monitor' },
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Determine test type from path
  const testType = location.pathname.startsWith('/mobile-test') ? 'mobile-test'
    : location.pathname.startsWith('/web-test') ? 'web-test'
    : location.pathname.startsWith('/pc-test') ? 'pc-test'
    : 'api-test';
  const sections = MENUS_BY_TYPE[testType] || MENUS_BY_TYPE['api-test'];
  const brand = BRAND_CONFIG[testType] || BRAND_CONFIG['api-test'];

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const displayName = user?.nickname || user?.account?.slice(0, 8) || 'User';
  const firstChar = displayName.charAt(0).toUpperCase();
  const avatarSrc = user?.avatar && !user.avatar.startsWith('data:') ? user.avatar : null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="sys-shell">
      {/* Sidebar */}
      <aside className="sys-sidebar">
        <div className="sys-brand">
          <div className="sys-brand-dot" style={{ background: brand.color }}>
            {icons[brand.icon]}
          </div>
          <div className="sys-brand-text">{brand.name}</div>
        </div>
        <nav className="sys-nav">
          {sections.map((sec) => (
            <div key={sec.section} className="sys-nav-section">
              <div className="sys-nav-section-title">{sec.section}</div>
              {sec.items.map((item) => (
                <button
                  key={item.path}
                  className={`sys-nav-item ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  {icons[item.icon]}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sys-sidebar-footer" />
      </aside>

      {/* Main area */}
      <div className="sys-main">
        <div className="sys-header">
          <div className="sys-header-left">
            <button className="sys-back" onClick={() => navigate('/')}>
              ← 返回主页
            </button>
          </div>
          <div className="sys-header-right">
            {/* Environment switcher */}
            {environments && environments.length > 0 && (
              <div className="hdr-env-switcher" ref={envRef}>
                <button className="hdr-env-btn" onClick={() => setEnvOpen(!envOpen)}>
                  <span className="hdr-env-dot" />
                  {activeEnv ? activeEnv.name : '选择环境'}
                  <span className="hdr-env-arrow">▾</span>
                </button>
                {envOpen && (
                  <div className="hdr-env-dropdown">
                    {environments.map((env: any) => (
                      <button key={env.id} className={`hdr-env-item ${activeEnv?.id === env.id ? 'active' : ''}`}
                        onClick={() => { setActiveEnv(env); setEnvOpen(false); }}>
                        <span className="hdr-env-dot" />
                        <span>{env.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* User menu */}
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
                  <button className="hdr-user-dropdown-item" onClick={() => navigate('/profile')}>修改资料</button>
                  <button className="hdr-user-dropdown-item" onClick={() => navigate('/change-password')}>修改密码</button>
                  <div className="hdr-user-dropdown-divider" />
                  <button className="hdr-user-dropdown-item danger" onClick={handleLogout}>退出登录</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="sys-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
