import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { apiFetch } from '../utils/api';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import UserMenu from '../components/UserMenu';
import './Home.css';

// AutoTest Platform mark — content inlined from public/brand/autotest-mark-currentColor.svg
// (200x200 viewBox, currentColor strokes — inherits the surrounding color so it
// adapts to the active theme). Sized to 22x22 to match the previous header logo.
const LogoSvg = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 200 200"
    role="img"
    aria-label="AutoTest Platform"
    fill="none"
    stroke="currentColor"
    strokeWidth={6}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ color: 'var(--accent)' }}
  >
    <path d="M40 54 L69 18 L91 57 L109 57 L131 18 L160 54 L148 124 L104 178 L96 178 L52 124 Z" />
    <path d="M69 18 L84 76 L54 63" />
    <path d="M131 18 L116 76 L146 63" />
    <path d="M84 76 L63 122 L96 178" />
    <path d="M116 76 L137 122 L104 178" />
    <path d="M84 76 L100 99 L116 76" />
    <path d="M100 99 L96 178" />
    <path d="M63 122 L42 103" />
    <path d="M137 122 L158 103" />
    <circle cx="122" cy="92" r="20" />
    <path d="M122 72 L134 91 L122 92 Z" />
    <path d="M142 92 L124 105 L122 92 Z" />
    <path d="M113 109 L116 88 L122 92 Z" />
    <circle cx="122" cy="92" r="4" fill="currentColor" stroke="none" />
    <path d="M139 151 L148 160 L165 138" strokeWidth={7} stroke="#22C55E" />
  </svg>
);

interface TestTypeStats {
  cases: number;
  sets: number;
  passRate: number;
}

interface TrendPoint {
  date: string;
  passRate: number;
  count: number;
  passed: number;
  failed: number;
}

interface TrendSummary {
  total: number;
  passed: number;
  failed: number;
}

interface PendingItem {
  id: number;
  title: string;
  status: 'pending' | 'completed';
  created_at: string;
  completed_at: string | null;
}


const formatTime = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const testTypes = [
  {
    key: 'api-test',
    name: '接口测试',
    desc: 'API 接口自动化测试管理',
    color: 'oklch(95% 0.04 250)',
    stroke: 'oklch(55% 0.2 250)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    path: '/api-test',
    casesLabel: '用例',
    setsLabel: '场景集',
  },
  {
    key: 'web-test',
    name: 'Web 测试',
    desc: 'Web 端 UI 自动化测试',
    color: 'oklch(95% 0.04 145)',
    stroke: 'oklch(55% 0.16 145)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    path: '/web-test',
    casesLabel: '用例',
    setsLabel: '用例集',
  },
  {
    key: 'mobile-test',
    name: '移动端测试',
    desc: 'Android / iOS App 自动化测试',
    color: 'oklch(95% 0.04 75)',
    stroke: 'oklch(60% 0.15 75)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>,
    path: '/mobile-test',
    casesLabel: '用例',
    setsLabel: '用例集',
  },
  {
    key: 'pc-test',
    name: 'PC 端测试',
    desc: '桌面客户端自动化测试',
    color: 'oklch(95% 0.04 300)',
    stroke: 'oklch(55% 0.15 300)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
    path: '/pc-test',
    casesLabel: '用例',
    setsLabel: '用例集',
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [addingTodo, setAddingTodo] = useState(false);
  const [todoInputOpen, setTodoInputOpen] = useState(false);
  const [stats, setStats] = useState<Record<string, TestTypeStats>>({});
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendSummary, setTrendSummary] = useState<TrendSummary>({ total: 0, passed: 0, failed: 0 });
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const { theme, toggleTheme } = useThemeContext();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch<Record<string, TestTypeStats>>('/dashboard/stats'),
      apiFetch<{ trend: TrendPoint[]; summary: TrendSummary }>('/dashboard/trend?days=14'),
      apiFetch<PendingItem[]>('/dashboard/pending'),
    ])
      .then(([statsRes, trendRes, pendingRes]) => {
        setStats(statsRes.data || {});
        setTrend(trendRes.data?.trend || []);
        setTrendSummary(trendRes.data?.summary || { total: 0, passed: 0, failed: 0 });
        setPending(pendingRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const displayName = user?.nickname || user?.account?.slice(0, 8) || '管理员';
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <div className="home-shell page-enter">
      <div className="home-header">
        <div className="home-header-title">
          <LogoSvg />
          <span>AutoTest Platform</span>
        </div>
        <div className="home-header-actions">
          <button className="hdr-theme-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色' : '切换暗色'}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          {environments.length > 0 && (
            <div className="hdr-env-switcher" ref={envRef}>
              <button className="hdr-env-btn" onClick={() => setEnvOpen(!envOpen)}>
                <span className="hdr-env-dot" />
                {activeEnv ? activeEnv.name : '选择环境'}
                <span className="hdr-env-arrow">▾</span>
              </button>
              {envOpen && (
                <div className="hdr-env-dropdown">
                  {environments.map(env => (
                    <button key={env.id} className={`hdr-env-item ${activeEnv?.id === env.id ? 'active' : ''}`}
                      onClick={() => { setActiveEnv(env); setEnvOpen(false); }}>
                      <span className="hdr-env-dot" />
                      <span>{env.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <UserMenu />
        </div>
      </div>

      <div className="home-body">
        <div className="home-welcome">欢迎回来，{displayName}</div>
        <div className="home-subtitle">平台概览 — {dateStr}</div>

        <div className="kanban-grid">
          {testTypes.map(t => {
            const s = stats[t.key] || { cases: 0, sets: 0, passRate: 0 };
            const rateColor = s.passRate >= 90 ? 'var(--success)' : s.passRate > 0 ? 'var(--warning)' : 'var(--fg-tertiary)';
            return (
            <div key={t.key} className="kanban-card" onClick={() => navigate(t.path)}>
              <div className="kanban-icon" style={{ background: t.color, color: t.stroke }}>
                {t.icon}
              </div>
              <div className="kanban-name">{t.name}</div>
              <div className="kanban-desc">{t.desc}</div>
              <div className="kanban-stats">
                <div><div className="kanban-stat-val">{loading ? '-' : s.cases}</div><div className="kanban-stat-label">{t.casesLabel}</div></div>
                <div><div className="kanban-stat-val">{loading ? '-' : s.sets}</div><div className="kanban-stat-label">{t.setsLabel}</div></div>
              </div>
              <div className="kanban-rate">
                <div className="kanban-rate-bar">
                  <div className="kanban-rate-fill" style={{ width: `${s.passRate}%`, background: rateColor }} />
                </div>
                <div className="kanban-rate-val" style={{ color: rateColor }}>{loading ? '-' : `${s.passRate}%`}</div>
              </div>
            </div>
            );
          })}
        </div>

        <div className="home-bottom-grid">
          <div className="home-panel home-panel-chart">
            <div className="home-panel-head">执行趋势 <span className="home-panel-sub">近 14 天</span></div>
            <div className="trend-summary-row">
              <div className="trend-summary-card">
                <div className="trend-summary-val">{loading ? '-' : trendSummary.total}</div>
                <div className="trend-summary-label">执行总次数</div>
              </div>
              <div className="trend-summary-card">
                <div className="trend-summary-val" style={{ color: 'var(--success)' }}>{loading ? '-' : trendSummary.passed}</div>
                <div className="trend-summary-label">成功</div>
              </div>
              <div className="trend-summary-card">
                <div className="trend-summary-val" style={{ color: 'var(--danger)' }}>{loading ? '-' : trendSummary.failed}</div>
                <div className="trend-summary-label">失败</div>
              </div>
              <div className="trend-summary-card">
                <div className="trend-summary-val" style={{ color: 'var(--accent)' }}>{loading ? '-' : (trendSummary.total > 0 ? `${Math.round((trendSummary.passed / (trendSummary.passed + trendSummary.failed)) * 100)}%` : '-')}</div>
                <div className="trend-summary-label">通过率</div>
              </div>
            </div>
            {trend.length === 0 && !loading ? (
              <div className="home-empty">暂无执行数据</div>
            ) : (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradRate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }}
                      formatter={(value: number, name: string) => {
                        if (name === 'passRate') return [`${value}%`, '通过率'];
                        return [value, '执行次数'];
                      }}
                      labelFormatter={label => label}
                    />
                    <Area yAxisId="left" type="monotone" dataKey="passRate" stroke="var(--accent)" strokeWidth={2} fill="url(#gradRate)" dot={false} />
                    <Area yAxisId="right" type="monotone" dataKey="count" stroke="var(--success)" strokeWidth={2} fill="url(#gradCount)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="chart-legend">
                  <span className="chart-legend-item"><span className="chart-legend-dot" style={{ background: 'var(--accent)' }} />通过率</span>
                  <span className="chart-legend-item"><span className="chart-legend-dot" style={{ background: 'var(--success)' }} />执行次数</span>
                </div>
              </div>
            )}
          </div>

          <div className="home-panel home-panel-pending">
            <div className="home-panel-head">
              待办事项
              {!todoInputOpen && (
                <button
                  className="pending-add-toggle"
                  title="添加待办"
                  onClick={() => setTodoInputOpen(true)}
                >+</button>
              )}
            </div>
            {todoInputOpen && (
              <div className="pending-add-row">
                <input
                  autoFocus
                  className="pending-add-input"
                  placeholder="输入待办事项，回车添加"
                  value={newTodoTitle}
                  onChange={(e) => setNewTodoTitle(e.target.value)}
                  onBlur={() => { if (!newTodoTitle.trim()) setTodoInputOpen(false); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setNewTodoTitle(''); setTodoInputOpen(false); }
                    if (e.key === 'Enter' && newTodoTitle.trim() && !addingTodo) {
                      setAddingTodo(true);
                      apiFetch<{ id: number; title: string; status: string }>('/dashboard/pending', {
                        method: 'POST',
                        body: JSON.stringify({ title: newTodoTitle.trim() }),
                      }).then((res) => {
                        if (res.data) {
                          setPending(prev => [{
                            id: res.data!.id,
                            title: res.data!.title,
                            status: 'pending',
                            created_at: new Date().toISOString(),
                            completed_at: null,
                          }, ...prev]);
                          setNewTodoTitle('');
                          setTodoInputOpen(false);
                        }
                      }).finally(() => setAddingTodo(false));
                    }
                  }}
                />
              </div>
            )}
            {pending.length === 0 && !loading ? (
              <div className="home-empty">暂无待办事项</div>
            ) : (
              <div className="pending-list">
                {pending.map((p) => {
                  const isCompleted = p.status === 'completed';
                  return (
                    <div
                      key={p.id}
                      className={`pending-item ${isCompleted ? 'pending-item--done' : ''}`}
                    >
                      <button
                        className={`pending-check ${isCompleted ? 'pending-check--done' : ''}`}
                        title={isCompleted ? '标记为未完成' : '标记为完成'}
                        onClick={() => {
                          apiFetch<{ id: number; status: string; completed_at: string | null }>(`/dashboard/pending/${p.id}/complete`, {
                            method: 'PUT',
                          }).then((res) => {
                            if (res.data) {
                              setPending(prev => prev.map(item =>
                                item.id === p.id
                                  ? { ...item, status: res.data!.status as 'pending' | 'completed', completed_at: res.data!.completed_at }
                                  : item,
                              ));
                            }
                          });
                        }}
                      >
                        {isCompleted && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </button>
                      <div className="pending-main">
                        <div className="pending-title">{p.title}</div>
                        <div className="pending-time">{formatTime(p.created_at)}</div>
                      </div>
                      <button
                        className="pending-delete"
                        title="删除"
                        onClick={() => {
                          apiFetch(`/dashboard/pending/${p.id}`, { method: 'DELETE' }).then(() => {
                            setPending(prev => prev.filter(item => item.id !== p.id));
                          });
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
