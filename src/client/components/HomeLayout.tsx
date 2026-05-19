import { Outlet, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import Header from './Header';
import TestTypeModal from './TestTypeModal';
import { useAuth } from '../contexts/AuthContext';
import './HomeLayout.css';

export default function HomeLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showTestTypeModal, setShowTestTypeModal] = useState(true); // 项目首页自动显示弹窗
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

  const displayName = user?.nickname || user?.account?.slice(0, 8) || 'User';
  const firstChar = displayName.charAt(0).toUpperCase();

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="home-layout">
      <Header showSwitch onSwitchTestType={() => setShowTestTypeModal(true)} />
      <main className="home-layout-main">
        <Outlet />
      </main>
      <TestTypeModal
        open={showTestTypeModal}
        onClose={() => setShowTestTypeModal(false)}
      />
    </div>
  );
}