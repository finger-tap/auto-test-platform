import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import './Layout.css';

const MENUS = [
  { label: '接口用例', path: '/api-test', icon: '🔌' },
  { label: '场景用例', path: '/scenario', icon: '📁' },
  { label: '定时执行', path: '/schedule', icon: '⏰' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div className="layout">
      <Header showSwitch />
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
