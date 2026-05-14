import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TestTypeModal from '../components/TestTypeModal';
import './Home.css';

export default function Home() {
  const [showModal, setShowModal] = useState(true);
  const { user } = useAuth();
  const displayName = user?.nickname || user?.account || '';

  return (
    <div className="home">
      <TestTypeModal open={showModal} onClose={() => setShowModal(false)} />
      <div className="home-welcome">
        <h1>Auto Test Platform</h1>
        <p className="home-subtitle">欢迎，{displayName}</p>
        <p className="home-hint">请选择测试类型开始</p>
        {!showModal && (
          <button className="home-reopen" onClick={() => setShowModal(true)}>
            选择测试类型
          </button>
        )}
      </div>
    </div>
  );
}
