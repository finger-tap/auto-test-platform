// 2026-06-11: 用户配置 Drawer — 右侧滑出,只覆盖 body 区域。
// 从 SettingsLayout 提取,改为 SysHeader 内触发的弹窗。

import { useState } from 'react';
import Profile from '../pages/Profile';
import ChangePassword from '../pages/ChangePassword';
import DeviceList from '../pages/system/DeviceList';
import MidsceneConfig from '../pages/system/MidsceneConfig';
import WebBrowserConfig from '../pages/system/WebBrowserConfig';
import './SettingsDrawer.css';

type PageKey = 'profile' | 'security' | 'devices' | 'model-config' | 'browser-config';

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
  key: PageKey;
  icon: string;
  hint?: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    section: '账号',
    items: [
      { label: '个人资料', key: 'profile', icon: 'user' },
      { label: '账号安全', key: 'security', icon: 'lock' },
    ],
  },
  {
    section: '我的资源',
    items: [
      { label: '设备库', key: 'devices', icon: 'device' },
      { label: '模型配置', key: 'model-config', icon: 'brain' },
      { label: '浏览器配置', key: 'browser-config', icon: 'env', hint: '仅 Web 测试' },
    ],
  },
];

const PAGE_TITLES: Record<PageKey, string> = {
  profile: '个人资料',
  security: '账号安全',
  devices: '设备库',
  'model-config': '模型配置',
  'browser-config': '浏览器配置',
};

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const [activePage, setActivePage] = useState<PageKey>('profile');

  const renderPage = () => {
    switch (activePage) {
      case 'profile': return <Profile />;
      case 'security': return <ChangePassword />;
      case 'devices': return <DeviceList />;
      case 'model-config': return <MidsceneConfig />;
      case 'browser-config': return <WebBrowserConfig />;
    }
  };

  return (
    <div className={`sd-mask ${open ? 'open' : ''}`} onClick={onClose}>
      <aside
        className={`sd-drawer ${open ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="complementary"
        aria-label="用户设置"
      >
        <div className="sd-sidebar">
          <div className="sd-sidebar-title">
            {icons.gear}
            账号与设置
          </div>
          {SECTIONS.map((sec) => (
            <div key={sec.section} className="sd-nav-section">
              <div className="sd-nav-section-title">{sec.section}</div>
              {sec.items.map((item) => (
                <button
                  key={item.key}
                  className={`sd-nav-item ${activePage === item.key ? 'active' : ''}`}
                  onClick={() => setActivePage(item.key)}
                >
                  {icons[item.icon]}
                  <span>{item.label}</span>
                  {item.hint && <span className="sd-nav-item-hint">{item.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="sd-content">
          <div className="sd-header">
            <span className="sd-header-title">{PAGE_TITLES[activePage]}</span>
            <button className="sd-close" onClick={onClose} aria-label="关闭设置">×</button>
          </div>
          <div className="sd-body">
            {renderPage()}
          </div>
        </div>
      </aside>
    </div>
  );
}
