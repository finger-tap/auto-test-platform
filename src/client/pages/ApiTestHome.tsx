import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import './ApiTestHome.css';

interface Stats {
  apiCount: number;
  scenarioCount: number;
  scenarioSetCount: number;
  passRate: number;
}

interface RecentExecution {
  id: number;
  test_type: string;
  set_id: number;
  set_name: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_at: string;
}

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
};

const formatTimeShort = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function ApiTestHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ apiCount: 0, scenarioCount: 0, scenarioSetCount: 0, passRate: 0 });
  const [reports, setReports] = useState<RecentExecution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ 'api-test': { cases: number; sets: number; passRate: number } }>('/dashboard/stats'),
      apiFetch<{ total: number }>('/scenarios?page=1&pageSize=1'),
      apiFetch<{ items: RecentExecution[] }>('/dashboard/recent-executions?limit=5'),
    ]).then(([statsRes, scenariosRes, reportsRes]) => {
      const apiStats = statsRes.data?.['api-test'];
      setStats({
        apiCount: apiStats?.cases || 0,
        scenarioCount: scenariosRes.data?.total || 0,
        scenarioSetCount: apiStats?.sets || 0,
        passRate: apiStats?.passRate || 0,
      });
      setReports(reportsRes.data?.items || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: '用例数', value: loading ? '-' : stats.apiCount, color: 'var(--accent)' },
    { label: '场景数', value: loading ? '-' : stats.scenarioCount, color: 'var(--accent)' },
    { label: '场景集数', value: loading ? '-' : stats.scenarioSetCount, color: 'var(--accent)' },
    { label: '通过率', value: loading ? '-' : `${stats.passRate}%`, color: stats.passRate >= 90 ? 'var(--success)' : stats.passRate > 0 ? 'var(--warning)' : 'var(--fg-tertiary)' },
  ];

  const quickActions = [
    { label: '新建用例', path: '/api-test/case/new', icon: <path d="M12 5v14M5 12h14" /> },
    { label: '新建场景', path: '/api-test/scene', icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></> },
    { label: '新建场景集', path: '/api-test/case-set', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></> },
    { label: '环境管理', path: '/api-test/environment', icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4" /></> },
  ];

  return (
    <div className="dashboard-home page-enter">
      <div className="dashboard-cards">
        {statCards.map((c, i) => (
          <div key={i} className="dashboard-stat-card">
            <div className="dashboard-stat-label">{c.label}</div>
            <div className="dashboard-stat-value" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-panel" style={{ marginBottom: 20 }}>
        <div className="dashboard-panel-head">快捷操作</div>
        <div className="shortcut-grid">
          {quickActions.map((a, i) => (
            <button key={i} className="shortcut-btn" onClick={() => navigate(a.path)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">{a.icon}</svg>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dashboard-panel">
        <div className="dashboard-panel-head">最近执行</div>
        {reports.length === 0 && !loading ? (
          <div className="dashboard-empty">暂无执行记录</div>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>场景集</th>
                <th>通过</th>
                <th>失败</th>
                <th>通过率</th>
                <th>耗时</th>
                <th>执行时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => {
                const total = r.passed + r.failed;
                const rate = total > 0 ? Math.round((r.passed / total) * 100) : 0;
                return (
                  <tr key={r.id} onClick={() => navigate(`/api-test/case-set/${r.set_id}`)}>
                    <td className="td-name">{r.set_name}</td>
                    <td><span className="td-pass">{r.passed}</span></td>
                    <td><span className="td-fail">{r.failed}</span></td>
                    <td>
                      <span className={`td-badge ${rate >= 90 ? 'td-badge-success' : rate >= 70 ? 'td-badge-warning' : 'td-badge-danger'}`}>
                        {rate}%
                      </span>
                    </td>
                    <td className="td-mono">{formatDuration(r.total_duration_ms)}</td>
                    <td className="td-mono td-time">{formatTimeShort(r.executed_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
