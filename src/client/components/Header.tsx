import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

export default function Header({ showSwitch }: { showSwitch?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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

  return (
    <header className="hdr">
      <div className="hdr-left">
        <span className="hdr-logo" onClick={() => navigate('/')}>Auto Test Platform</span>
        {showSwitch && (
          <button className="hdr-switch" onClick={() => navigate('/')}>切换测试类型</button>
        )}
      </div>
      <div className="hdr-right" ref={dropdownRef}>
        <button className="hdr-user-btn" onClick={() => setDropdownOpen(!dropdownOpen)}>
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="hdr-avatar" />
          ) : (
            <span className="hdr-avatar-ph">{firstChar}</span>
          )}
          <span className="hdr-username">{displayName}</span>
          <span className={`hdr-arrow ${dropdownOpen ? 'open' : ''}`}>▾</span>
        </button>
        {dropdownOpen && (
          <div className="hdr-dropdown">
            <button className="hdr-dropdown-item" onClick={() => { setDropdownOpen(false); navigate('/profile'); }}>
              个人信息
            </button>
            <button className="hdr-dropdown-item" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
