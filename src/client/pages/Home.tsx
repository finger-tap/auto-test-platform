import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TestTypeModal from '../components/TestTypeModal';
import './Home.css';

export default function Home() {
  const [health, setHealth] = useState('');
  const [showModal, setShowModal] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('disconnected'));
  }, []);

  const displayName = user?.nickname || user?.account || '';

  return (
    <div className="home">
      <TestTypeModal open={showModal} onClose={() => setShowModal(false)} />
      <div className="home-welcome">
        <h1>Auto Test Platform</h1>
        <p className="home-subtitle">欢迎，{displayName}</p>
        <p className="home-status">
          服务状态：{' '}
          <span className={health === 'ok' ? 'status-ok' : 'status-error'}>
            {health || '...'}
          </span>
        </p>
        {!showModal && (
          <button className="home-reopen" onClick={() => setShowModal(true)}>
            选择测试类型
          </button>
        )}
      </div>
    </div>
  );
}
