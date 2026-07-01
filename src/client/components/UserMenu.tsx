import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SettingsDrawer from './SettingsDrawer';

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayName = user?.nickname || user?.account?.slice(0, 8) || '管理员';
  const firstChar = displayName.charAt(0).toUpperCase();
  const avatarSrc = user?.avatar && !user.avatar.startsWith('data:') ? user.avatar : null;

  const handleLogout = () => {
    logout();
    setOpen(false);
    navigate('/login');
  };

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu__button" onClick={() => setOpen(o => !o)} aria-label="用户菜单">
        <div className="user-menu__avatar">
          {avatarSrc ? <img src={avatarSrc} alt="" /> : firstChar}
        </div>
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <div className="user-menu__info">
            <div className="user-menu__name">{displayName}</div>
            <div className="user-menu__account">{user?.account || ''}</div>
          </div>
          <div className="user-menu__divider" />
          <button className="user-menu__item" onClick={() => { setOpen(false); setSettingsOpen(true); }}>
            账号与设置
          </button>
          <div className="user-menu__divider" />
          <button className="user-menu__item user-menu__item--danger" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      )}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
