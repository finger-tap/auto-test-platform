import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import Header from './Header';
import TestTypeModal from './TestTypeModal';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

const MENUS = [
  { label: '接口用例', path: '/api-test/api-case', icon: '🔌' },
  { label: '场景用例', path: '/api-test/scene-case', icon: '📁' },
  { label: '场景集', path: '/api-test/scene-set', icon: '📦' },
  { label: '定时执行', path: '/api-test/schedule', icon: '⏰' },
  { label: '批量报告', path: '/api-test/batch-report', icon: '📊' },
  { label: 'Mock 服务', path: '/api-test/mock', icon: '🎭' },
  { label: '环境管理', path: '/api-test/environment', icon: '🌍' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showTestTypeModal, setShowTestTypeModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const displayName = user?.nickname || user?.account?.slice(0, 8) || 'User';
  const firstChar = displayName.charAt(0).toUpperCase();

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <Header showSwitch onSwitchTestType={() => setShowTestTypeModal(true)} />
      <div className="layout-body">
        <aside className="layout-sidebar">
          {MENUS.map((menu) => (
            <button
              key={menu.path}
              className={`layout-menu-item ${isActive(menu.path) ? 'active' : ''}`}
              onClick={() => navigate(menu.path)}
            >
              <span className="layout-menu-icon">{menu.icon}</span>
              <span>{menu.label}</span>
            </button>
          ))}
          {/* User info at bottom of sidebar */}
          <div className="layout-user-section" ref={dropdownRef}>
            <button className="layout-user-btn" onClick={() => setDropdownOpen(!dropdownOpen)}>
              <div className="layout-user-avatar">{firstChar}</div>
              <div className="layout-user-info">
                <div className="layout-user-name">{displayName}</div>
                <div className="layout-user-role">已登录</div>
              </div>
              <span className={`layout-user-arrow ${dropdownOpen ? 'open' : ''}`}>▾</span>
            </button>
            {dropdownOpen && (
              <div className="layout-user-dropdown">
                <button className="layout-dropdown-item" onClick={() => { setDropdownOpen(false); navigate('/profile'); }}>
                  个人信息
                </button>
                <button className="layout-dropdown-item" onClick={handleLogout}>
                  退出登录
                </button>
              </div>
            )}
          </div>
        </aside>
        <main className="layout-main">
          <Outlet />
        </main>
      </div>
      <TestTypeModal
        open={showTestTypeModal}
        onClose={() => setShowTestTypeModal(false)}
      />
    </div>
  );
}