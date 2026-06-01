import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import '../ApiTestHome.css';
import './WebTestHome.css';

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

export default function WebTestHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ caseCount: 0, scenarioCount: 0, scenarioSetCount: 0, runningSets: 0 });
  const [reports, setReports] = useState<BatchReportItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/web-cases?page=1&pageSize=1').catch(() => ({ data: { total: 0 } })),
      apiFetch<{ total: number }>('/scenarios-web?page=1&pageSize=1').catch(() => ({ data: { total: 0 } })),
      apiFetch<{ total: number }>('/scenario-sets-web?page=1&pageSize=1').catch(() => ({ data: { total: 0 } })),
      apiFetch<{ items: BatchReportItem[] }>('/batch-reports-web?page=1&pageSize=5').catch(() => ({ data: { items: [] } })),
    ]).then(([casesRes, scenesRes, setsRes, reportsRes]) => {
      setStats({
        caseCount: casesRes.data?.total || 0,
        scenarioCount: scenesRes.data?.total || 0,
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
    { label: '用例总数', value: loading ? '-' : stats.caseCount, sub: `+8 本月新增`, color: 'var(--accent)' },
    { label: '场景数', value: loading ? '-' : stats.scenarioCount, sub: `${stats.runningSets} 个运行中`, color: 'var(--accent)' },
    { label: '通过率', value: loading ? '-' : `${passRate}%`, sub: '最近 7 天', color: 'var(--success)' },
    { label: '场景集数', value: loading ? '-' : stats.scenarioSetCount, sub: `${stats.runningSets} 个执行中`, color: 'var(--warning)' },
  ];

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
                  <tr key={r.id} onClick={() => navigate(`/web-test/batch-report/${r.id}`)}>
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
