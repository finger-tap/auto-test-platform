import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import './ApiTestHome.css';

interface Stats {
  apiCount: number;
  scenarioCount: number;
  scenarioSetCount: number;
}

const QUICK_LINKS = [
  { key: 'api-new', icon: '⚡', label: '新建接口用例', path: '/api-test/api-case/new' },
  { key: 'scenario-new', icon: '📁', label: '创建场景集', path: '/api-test/scene-set/new' },
  { key: 'schedule', icon: '▶️', label: '定时执行', path: '/api-test/schedule' },
  { key: 'report', icon: '📊', label: '查看报告', path: '/api-test/batch-report' },
];

export default function ApiTestHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ apiCount: 0, scenarioCount: 0, scenarioSetCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/apis?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenarios?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenario-sets?page=1&pageSize=1'),
    ]).then(([apisRes, scenariosRes, setsRes]) => {
      setStats({
        apiCount: apisRes.data?.total || 0,
        scenarioCount: scenariosRes.data?.total || 0,
        scenarioSetCount: setsRes.data?.total || 0,
      });
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="api-test-home">
      <div className="api-test-home-content">
        <div className="api-test-logo-section">
          <div className="api-test-logo-wrapper">
            <div className="api-test-logo-icon">
              <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <span className="api-test-logo-text">接口测试</span>
          </div>
          <p className="api-test-tagline">自动化测试平台</p>
        </div>

        <div className="api-test-stats-grid">
          <div className="api-test-stat-card" onClick={() => navigate('/api-test/api-case')}>
            <div className="api-test-stat-number">{loading ? '-' : stats.apiCount}</div>
            <div className="api-test-stat-label">接口用例</div>
          </div>
          <div className="api-test-stat-card" onClick={() => navigate('/api-test/scene-case')}>
            <div className="api-test-stat-number">{loading ? '-' : stats.scenarioCount}</div>
            <div className="api-test-stat-label">场景用例</div>
          </div>
          <div className="api-test-stat-card" onClick={() => navigate('/api-test/scene-set')}>
            <div className="api-test-stat-number">{loading ? '-' : stats.scenarioSetCount}</div>
            <div className="api-test-stat-label">场景集</div>
          </div>
        </div>

        <div className="api-test-quick-actions">
          {QUICK_LINKS.map(link => (
            <div
              key={link.key}
              className="api-test-quick-btn"
              onClick={() => navigate(link.path)}
            >
              <div className="api-test-quick-icon">{link.icon}</div>
              <div className="api-test-quick-text">{link.label}</div>
            </div>
          ))}
        </div>

        <div className="api-test-footer">
          <p>AutoTest Platform · 智能驱动测试新体验</p>
        </div>
      </div>
    </div>
  );
}