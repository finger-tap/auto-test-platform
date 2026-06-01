import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import '../ApiTestHome.css';
import './MobileTestHome.css';

interface Stats {
  caseCount: number;
  scenarioCount: number;
  scenarioSetCount: number;
  runningSets: number;
}

interface BatchReportItem {
  id: number;
  set_name: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string;
  executed_at: string;
}

const formatDuration = (ms: number) => {
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${(ms / 3600000).toFixed(1)}h`;
};

const formatTimeShort = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function MobileTestHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ caseCount: 0, scenarioCount: 0, scenarioSetCount: 0, runningSets: 0 });
  const [reports, setReports] = useState<BatchReportItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/mobile-tests?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenarios-mobile?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenario-sets-mobile?page=1&pageSize=1'),
      apiFetch<{ items: BatchReportItem[] }>('/batch-reports-mobile?page=1&pageSize=5'),
    ]).then(([casesRes, scenariosRes, setsRes, reportsRes]) => {
      setStats({
        caseCount: casesRes.data?.total || 0,
        scenarioCount: scenariosRes.data?.total || 0,
        scenarioSetCount: setsRes.data?.total || 0,
        runningSets: 1,
      });
      setReports(reportsRes.data?.items || []);
    }).finally(() => setLoading(false));
  }, []);

  const totalExec = reports.reduce((s, r) => s + r.passed + r.failed, 0);
  const totalPassed = reports.reduce((s, r) => s + r.passed, 0);
  const passRate = totalExec > 0 ? Math.round((totalPassed / totalExec) * 100) : 0;

  const statCards = [
    { label: '用例总数', value: loading ? '-' : stats.caseCount, sub: `+5 本月新增`, color: 'var(--accent)' },
    { label: '场景数', value: loading ? '-' : stats.scenarioCount, sub: `${stats.runningSets} 个运行中`, color: 'var(--accent)' },
    { label: '通过率', value: loading ? '-' : `${passRate}%`, sub: '最近 7 天', color: passRate >= 90 ? 'var(--success)' : 'var(--warning)' },
    { label: '场景集数', value: loading ? '-' : stats.scenarioSetCount, sub: `${stats.runningSets} 个执行中`, color: 'var(--warning)' },
  ];

  const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const weekTrend = [passRate, passRate, passRate, passRate, passRate, passRate, passRate];

  return (
    <div className="dashboard-home">
      <div className="dashboard-cards">
        {statCards.map((c, i) => (
          <div key={i} className="dashboard-stat-card">
            <div className="dashboard-stat-label">{c.label}</div>
            <div className="dashboard-stat-value" style={{ color: c.color }}>{c.value}</div>
            <div className="dashboard-stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-panel" style={{ marginBottom: 20 }}>
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
                  <tr key={r.id} onClick={() => navigate(`/mobile-test/batch-report/${r.id}`)}>
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

      <div className="dash-bottom">
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">近 7 天趋势</div>
          <div className="trend-chart">
            {weekDays.map((day, i) => {
              const h = Math.round((weekTrend[i] / 100) * 100);
              const color = weekTrend[i] >= 90 ? 'var(--success)' : weekTrend[i] >= 70 ? 'var(--warning)' : 'var(--danger)';
              return (
                <div key={i} className="trend-col">
                  <div className="trend-bar-wrap">
                    <div
                      className="trend-bar"
                      style={{ height: `${h}%`, background: color }}
                    />
                  </div>
                  <div className="trend-label">{day}</div>
                  <div className="trend-pct">{weekTrend[i]}%</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">快捷入口</div>
          <div className="shortcut-grid">
            <button className="shortcut-btn" onClick={() => navigate('/mobile-test/test-case/new')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              新建用例
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/mobile-test/scene-case/new')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              新建场景
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/mobile-test/environment')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9"/></svg>
              环境管理
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/mobile-test/system-config')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1"/></svg>
              标签管理
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}