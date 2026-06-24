import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import SysHeader from './SysHeader';
import './Layout.css';

// SVG icons for the settings sidebar.
const icons: Record<string, React.ReactNode> = {
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/></svg>,
  lock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>,
  device: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>,
  brain: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a4 4 0 00-4 4v0a3 3 0 00-3 3v0a3 3 0 00.5 1.7A3 3 0 005 12.5 3 3 0 008 15v1a3 3 0 003 3 3 3 0 003-3v-1a3 3 0 003-2.5 3 3 0 00-.5-1.7A3 3 0 0016 9v0a3 3 0 00-3-3v0a4 4 0 00-1-3z" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 6v14M9 9l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  env: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9"/></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9"/></svg>,
};

interface NavItem {
  label: string;
  path: string;
  icon: string;
  hint?: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

// 2026-06-08: 独立于 4 个测试类型 Layout 的用户中心侧边栏。
// 设备库 / 模型配置 / 浏览器配置 都是 per-user 资源,放在这里更准确。
// `浏览器配置` 标注 "仅 Web 测试使用" 让用户知道作用域。
const SECTIONS: NavSection[] = [
  {
    section: '账号',
    items: [
      { label: '个人资料', path: '/settings/profile', icon: 'user' },
      { label: '账号安全', path: '/settings/security', icon: 'lock' },
    ],
  },
  {
    section: '我的资源',
    items: [
      { label: '设备库', path: '/settings/devices', icon: 'device' },
      { label: '模型配置', path: '/settings/model-config', icon: 'brain' },
      { label: '浏览器配置', path: '/settings/browser-config', icon: 'env', hint: '仅 Web 测试使用' },
    ],
  },
];

const BRAND = { name: '账号与设置', color: 'oklch(95% 0.04 220)', icon: 'gear' };

export default function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div className="sys-shell">
      <aside className="sys-sidebar">
        <div className="sys-brand">
          <div className="sys-brand-dot" style={{ background: BRAND.color }}>
            {icons[BRAND.icon]}
          </div>
          <div className="sys-brand-text">{BRAND.name}</div>
        </div>
        <nav className="sys-nav">
          {SECTIONS.map((sec) => (
            <div key={sec.section} className="sys-nav-section">
              <div className="sys-nav-section-title">{sec.section}</div>
              {sec.items.map((item) => (
                <button
                  key={item.path}
                  className={`sys-nav-item ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                  title={item.hint}
                >
                  {icons[item.icon]}
                  <span>{item.label}</span>
                  {item.hint && <span className="sys-nav-item-hint">{item.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sys-sidebar-footer" />
      </aside>

      <div className="sys-main">
        <SysHeader />
        <div className="sys-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
