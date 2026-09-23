import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SettingsDrawer from './SettingsDrawer';

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, centerUser, logout } = useAuth();
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

  // 2026-08-23: 团队账户独立登录时（无本地账号）显示中心身份
  const identity = user
    ? { name: user.nickname || user.account?.slice(0, 8) || '用户', account: user.account || '', tag: '个人账户' }
    : centerUser
      ? { name: centerUser.nickname || centerUser.account.slice(0, 8), account: centerUser.account, tag: '团队账户' }
      : { name: '用户', account: '', tag: '' };
  const displayName = identity.name;
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
            <div className="user-menu__account">{identity.account}{identity.tag ? ` · ${identity.tag}` : ''}</div>
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
