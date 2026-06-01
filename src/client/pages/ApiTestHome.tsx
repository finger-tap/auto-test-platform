import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import './ApiTestHome.css';

interface Stats {
  apiCount: number;
  scenarioCount: number;
  scenarioSetCount: number;
}

interface ScenarioSetExecution {
  id: number;
  set_id: number;
  set_name: string;
  status: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string;
  started_at: string;
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
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Mock trend data for 7 days
const trendData = [
  { day: '周一', pct: 92, ok: true },
  { day: '周二', pct: 88, ok: true },
  { day: '周三', pct: 65, ok: false },
  { day: '周四', pct: 95, ok: true },
  { day: '周五', pct: 90, ok: true },
  { day: '周六', pct: 97, ok: true },
  { day: '周日', pct: 78, ok: true },
];
const maxPct = Math.max(...trendData.map(d => d.pct));

export default function ApiTestHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ apiCount: 0, scenarioCount: 0, scenarioSetCount: 0 });
  const [recentExecutions, setRecentExecutions] = useState<ScenarioSetExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyAdded, setMonthlyAdded] = useState(0);
  const [runningSets, setRunningSets] = useState(0);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/apis?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenarios?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/scenario-sets?page=1&pageSize=1'),
      apiFetch<{ total: number }>('/apis?page=1&pageSize=1&created_after=' + new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
    ]).then(([apisRes, scenariosRes, setsRes, monthlyRes]) => {
      setStats({
        apiCount: apisRes.data?.total || 0,
        scenarioCount: scenariosRes.data?.total || 0,
        scenarioSetCount: setsRes.data?.total || 0,
      });
      setMonthlyAdded(monthlyRes.data?.total || 0);
    }).catch(() => {}).finally(() => setLoading(false));

    // 查询所有场景集的最新执行情况（用于统计 running 状态）
    apiFetch<{ items: any[] }>('/scenario-sets?page=1&pageSize=100').then(res => {
      const sets = res.data?.items || [];
      // running sets 是那些最近执行状态为 running 的场景集
      const running = sets.filter((s: any) => s.execution_summary && s.execution_summary.last_executed_at && false).length;
      setRunningSets(running);
    }).catch(() => {});

    // 查询最近执行：从 scenario-sets 列表中获取执行统计数据
    // 先获取场景集列表（包含执行统计），然后按 last_executed_at 排序取前5
    apiFetch<{ items: any[] }>('/scenario-sets?page=1&pageSize=100').then(res => {
      const sets = res.data?.items || [];
      // 提取每个场景集的执行汇总，按最近执行时间排序
      const executionsWithTime = sets
        .filter((s: any) => s.execution_summary && s.execution_summary.last_executed_at)
        .map((s: any) => ({
          id: s.id,
          set_id: s.id,
          set_name: s.name,
          status: s.execution_summary.passed + s.execution_summary.failed === 0 ? 'not_executed' :
            s.execution_summary.failed > 0 ? 'failed' : 'success',
          passed: s.execution_summary.passed,
          failed: s.execution_summary.failed,
          total_duration_ms: 0,
          executed_by: '',
          started_at: s.execution_summary.last_executed_at,
        }))
        .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 5);
      setRecentExecutions(executionsWithTime);
    }).catch(() => {});
  }, []);

  // 计算通过率（从最近执行记录）
  const totalExec = recentExecutions.reduce((s, r) => s + r.passed + r.failed, 0);
  const totalPassed = recentExecutions.reduce((s, r) => s + r.passed, 0);
  const passRate = totalExec > 0 ? Math.round((totalPassed / totalExec) * 100) : 0;

  const statCards = [
    { label: '用例总数', value: loading ? '-' : stats.apiCount, sub: `+${monthlyAdded} 本月新增`, color: 'var(--accent)' },
    { label: '场景数', value: loading ? '-' : stats.scenarioCount, sub: `${runningSets} 个运行中`, color: 'var(--accent)' },
    { label: '通过率', value: loading ? '-' : `${passRate}%`, sub: '最近 7 天', color: passRate >= 90 ? 'var(--success)' : 'var(--warning)' },
    { label: '场景集数', value: loading ? '-' : stats.scenarioSetCount, sub: `${runningSets} 个执行中`, color: 'var(--accent)' },
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
        {recentExecutions.length === 0 && !loading ? (
          <div className="dashboard-empty">暂无执行记录</div>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>场景集</th>
                <th>通过</th>
                <th>失败</th>
                <th>通过率</th>
                <th>执行时间</th>
              </tr>
            </thead>
            <tbody>
              {recentExecutions.map(r => {
                const total = r.passed + r.failed;
                const rate = total > 0 ? Math.round((r.passed / total) * 100) : 0;
                return (
                  <tr key={r.id} onClick={() => navigate(`/api-test/scenario-set/${r.set_id}`)} style={{ cursor: 'pointer' }}>
                    <td className="td-name">{r.set_name}</td>
                    <td><span className="td-pass">{r.passed}</span></td>
                    <td><span className="td-fail">{r.failed}</span></td>
                    <td><span className={`td-badge ${rate >= 90 ? 'td-badge-success' : rate >= 70 ? 'td-badge-warning' : 'td-badge-danger'}`}>{rate}%</span></td>
                    <td className="td-mono td-time">{formatTimeShort(r.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="dashboard-bottom">
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">近 7 天趋势</div>
          <div className="trend-chart">
            {trendData.map((d, i) => (
              <div key={i} className="trend-col">
                <div className="trend-bar-wrap">
                  <div
                    className="trend-bar"
                    style={{
                      height: `${(d.pct / maxPct) * 100}%`,
                      background: d.ok ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                    }}
                  />
                </div>
                <span className="trend-label">{d.day}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="dashboard-panel">
          <div className="dashboard-panel-head">快捷入口</div>
          <div className="shortcut-grid">
            <button className="shortcut-btn" onClick={() => navigate('/api-test/api-case/new')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              新建用例
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/api-test/scene-case')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>
              新建场景
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/api-test/mock')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Mock 服务
            </button>
            <button className="shortcut-btn" onClick={() => navigate('/api-test/environment')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4"/></svg>
              环境管理
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}