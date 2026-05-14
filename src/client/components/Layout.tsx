import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

const MENUS = [
  { label: '接口用例', path: '/api-test', icon: '🔌' },
  { label: '场景用例', path: '/scenario', icon: '📁' },
  { label: '定时执行', path: '/schedule', icon: '⏰' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  const displayName = user?.nickname || user?.account?.slice(0, 3) || 'U';
  const firstChar = displayName.charAt(0).toUpperCase();

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">Auto Test Platform</div>
        <div className="layout-right" ref={dropdownRef}>
          <button className="layout-user-btn" onClick={() => setDropdownOpen(!dropdownOpen)}>
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="layout-avatar" />
            ) : (
              <span className="layout-avatar-placeholder">{firstChar}</span>
            )}
            <span className="layout-username">{displayName}</span>
            <span className={`layout-arrow ${dropdownOpen ? 'open' : ''}`}>▾</span>
          </button>
          {dropdownOpen && (
            <div className="layout-dropdown">
              <button className="layout-dropdown-item" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>
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
        </aside>
        <main className="layout-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
