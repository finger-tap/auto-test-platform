import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEnvironment } from '../contexts/EnvironmentContext';
import SysHeader from './SysHeader';
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
  mobile: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" y="18" r="1"/></svg>,
  lightning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  globe: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
  monitor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  package: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
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

// 2026-06-08: 设备库 / 模型配置 / 浏览器配置 都是 per-user 资源,
// 不属于任何测试类型,已搬到独立的 /settings/* 路由(见 SettingsLayout)。
// 这里只留项目级 / 测试类型级的资源:Mock / 环境 / 标签。
const MENUS_BY_TYPE: Record<string, NavSection[]> = {
  'api-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/api-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/api-test/case', icon: 'doc' }] },
    { section: '场景编排', items: [
      { label: '场景列表', path: '/api-test/scene', icon: 'check' },
      { label: '场景集', path: '/api-test/case-set', icon: 'folder' },
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
    { section: '测试用例', items: [{ label: '用例列表', path: '/mobile-test/case', icon: 'mobile' }] },
    { section: '用例集', items: [
      { label: '用例集', path: '/mobile-test/case-set', icon: 'folder' },
    ]},
    { section: '执行管理', items: [
      { label: '定时任务', path: '/mobile-test/schedule', icon: 'clock' },
    ]},
    { section: '辅助功能', items: [
      { label: '应用管理', path: '/mobile-test/apps', icon: 'package' },
      { label: '环境管理', path: '/mobile-test/environment', icon: 'env' },
      { label: '标签管理', path: '/mobile-test/system-config', icon: 'tag' },
    ]},
  ],
  'web-test': [
    { section: '概览', items: [{ label: '仪表盘', path: '/web-test', icon: 'dashboard' }] },
    { section: '测试用例', items: [{ label: '用例列表', path: '/web-test/case', icon: 'doc' }] },
    { section: '用例集', items: [
      { label: '用例集', path: '/web-test/case-set', icon: 'folder' },
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
    { section: '用例集', items: [
      { label: '用例集', path: '/pc-test/case-set', icon: 'folder' },
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

const BRAND_CONFIG: Record<string, { name: string; color: string; stroke: string; icon: string }> = {
  'api-test': { name: '接口测试', color: 'oklch(95% 0.04 250)', stroke: 'oklch(55% 0.2 250)', icon: 'lightning' },
  'mobile-test': { name: '移动端测试', color: 'oklch(95% 0.04 75)', stroke: 'oklch(60% 0.15 75)', icon: 'mobile' },
  'web-test': { name: 'Web 测试', color: 'oklch(95% 0.04 145)', stroke: 'oklch(55% 0.16 145)', icon: 'globe' },
  'pc-test': { name: 'PC 测试', color: 'oklch(95% 0.04 300)', stroke: 'oklch(55% 0.15 300)', icon: 'monitor' },
};

// 侧边栏 brand 右侧"切换测试类型"下拉的可选项,顺序即下拉展示顺序
const TEST_TYPE_ORDER: { key: string; label: string; path: string }[] = [
  { key: 'api-test', label: '接口测试', path: '/api-test' },
  { key: 'web-test', label: 'Web 测试', path: '/web-test' },
  { key: 'pc-test', label: 'PC 测试', path: '/pc-test' },
  { key: 'mobile-test', label: '移动端测试', path: '/mobile-test' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine test type from path
  const testType = location.pathname.startsWith('/mobile-test') ? 'mobile-test'
    : location.pathname.startsWith('/web-test') ? 'web-test'
    : location.pathname.startsWith('/pc-test') ? 'pc-test'
    : 'api-test';
  const sections = MENUS_BY_TYPE[testType] || MENUS_BY_TYPE['api-test'];
  const brand = BRAND_CONFIG[testType] || BRAND_CONFIG['api-test'];

  const { setCurrentTestType } = useEnvironment();
  // 统一格式：'api-test' → 'api'，与 user_preferences 存储的 test_type 一致
  const shortType = testType.replace('-test', '');
  useEffect(() => { setCurrentTestType(shortType); }, [shortType, setCurrentTestType]);

  // brand 右侧"切换测试类型"下拉
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!typeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [typeDropdownOpen]);

  const isActive = (path: string) => {
    // 仪表盘是根路径，必须精确匹配，否则所有子页面都会命中
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 1) return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <div className="sys-shell">
      {/* Sidebar */}
      <aside className="sys-sidebar">
        <div className="sys-brand">
          <div className="sys-brand-dot" style={{ background: brand.color, color: brand.stroke }}>
            {icons[brand.icon]}
          </div>
          <div className="sys-brand-text">{brand.name}</div>
          <div className="sys-brand-actions" ref={typeDropdownRef}>
            <button
              type="button"
              className="sys-brand-icon-btn"
              onClick={() => setTypeDropdownOpen(o => !o)}
              title="切换测试类型"
              aria-label="切换测试类型"
              aria-haspopup="menu"
              aria-expanded={typeDropdownOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="7 10 12 5 17 10" />
                <polyline points="7 14 12 19 17 14" />
              </svg>
            </button>
            {typeDropdownOpen && (
              <div className="sys-brand-dropdown" role="menu">
                {TEST_TYPE_ORDER.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    className={`sys-brand-dropdown-item ${testType === t.key ? 'active' : ''}`}
                    onClick={() => { setTypeDropdownOpen(false); navigate(t.path); }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="sys-brand-icon-btn"
              onClick={() => navigate('/')}
              title="返回项目主页"
              aria-label="返回项目主页"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12l9-9 9 9" />
                <path d="M5 10v10h14V10" />
                <path d="M9 20v-6h6v6" />
              </svg>
            </button>
          </div>
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
        <SysHeader />
        <div className="sys-content">
          <Outlet />
        </div>
        <div className="sys-footer">
          <span className="sys-footer-name">OpenAutoTest</span>
          <span className="sys-footer-sep">·</span>
          <span className="sys-footer-ver">v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
