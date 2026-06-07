import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { apiFetch } from '../utils/api';
import './Home.css';

const LogoSvg = () => (
  <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
    <path d="M9 3L5 7l4 4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 3l4 4-4 4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M13 7l-2 10" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

interface TestTypeStats {
  cases: number;
  scenarios: number;
  sets: number;
  rate: number;
}

interface Activity {
  color: string;
  text: string;
  time: string;
}

interface PaginatedResponse {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
}

const testTypes = [
  {
    key: 'api-test',
    name: '接口测试',
    desc: 'API 接口自动化测试管理',
    color: 'oklch(95% 0.04 250)',
    stroke: 'oklch(55% 0.2 250)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    stats: { cases: 0, scenarios: 0, sets: 0, rate: 0 },
    path: '/api-test',
  },
  {
    key: 'web-test',
    name: 'Web 测试',
    desc: 'Web 端 UI 自动化测试',
    color: 'oklch(95% 0.04 145)',
    stroke: 'oklch(55% 0.16 145)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    stats: { cases: 0, scenarios: 0, sets: 0, rate: 0 },
    path: '/web-test',
  },
  {
    key: 'mobile-test',
    name: '移动端测试',
    desc: 'Android / iOS App 自动化测试',
    color: 'oklch(95% 0.04 75)',
    stroke: 'oklch(60% 0.15 75)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>,
    stats: { cases: 0, scenarios: 0, sets: 0, rate: 0 },
    path: '/mobile-test',
  },
  {
    key: 'pc-test',
    name: 'PC 端测试',
    desc: '桌面客户端自动化测试',
    color: 'oklch(95% 0.04 300)',
    stroke: 'oklch(55% 0.15 300)',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
    stats: { cases: 0, scenarios: 0, sets: 0, rate: 0 },
    path: '/pc-test',
  },
];

const shortcuts = [
  { label: '新建用例', path: '/api-test/api-case/new' },
  { label: '新建场景', path: '/api-test/scene' },
  { label: '定时任务', path: '/api-test/schedule' },
  { label: '场景集', path: '/api-test/scenario-set' },
  { label: 'Mock 服务', path: '/api-test/mock' },
  { label: '环境管理', path: '/api-test/environment' },
];

export default function Home() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { environments, activeEnv, setActiveEnv } = useEnvironment();
  const [envOpen, setEnvOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<Record<string, TestTypeStats>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load real stats from API
  useEffect(() => {
    Promise.all([
      apiFetch<PaginatedResponse>('/apis?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/scenarios?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/scenario-sets?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/web-cases?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/case-sets-web?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/case-sets-mobile?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/mobile-tests?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/pc-cases?page=1&pageSize=1'),
      apiFetch<PaginatedResponse>('/case-sets-pc?page=1&pageSize=1'),
    ]).then(([apiCasesRes, apiScenesRes, apiSetsRes, webCasesRes, webSetsRes, mobileSetsRes, mobileCasesRes, pcCasesRes, pcSetsRes]) => {
      console.log('API stats response:', apiCasesRes, apiScenesRes, apiSetsRes);
      setStats({
        'api-test': {
          cases: apiCasesRes.data?.total || 0,
          scenarios: apiScenesRes.data?.total || 0,
          sets: apiSetsRes.data?.total || 0,
          rate: 0,
        },
        'web-test': {
          cases: webCasesRes.data?.total || 0,
          scenarios: 0,
          sets: webSetsRes.data?.total || 0,
          rate: 0,
        },
        'mobile-test': {
          cases: mobileCasesRes.data?.total || 0,
          scenarios: 0,
          sets: mobileSetsRes.data?.total || 0,
          rate: 0,
        },
        'pc-test': {
          cases: pcCasesRes.data?.total || 0,
          scenarios: 0,
          sets: pcSetsRes.data?.total || 0,
          rate: 0,
        },
      });
      setActivities([
        { color: 'var(--accent)', text: '数据已加载', time: '刚刚' },
      ]);
    }).catch(() => {
      setActivities([]);
    }).finally(() => setLoading(false));
  }, []);

  const displayName = user?.nickname || user?.account?.slice(0, 8) || '管理员';
  const firstChar = displayName.charAt(0).toUpperCase();
  const avatarSrc = user?.avatar && !user.avatar.startsWith('data:') ? user.avatar : null;
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  const updateStats = (typeStats: typeof testTypes) => typeStats.map(t => ({
    ...t,
    stats: stats[t.key] || { cases: 0, scenarios: 0, sets: 0, rate: 0 },
  }));

  return (
    <div className="home-shell">
      <div className="home-header">
        <div className="home-header-title">
          <LogoSvg />
          <span>Auto Test Platform</span>
        </div>
        <div className="home-header-actions">
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
          <button className="home-user-btn" onClick={() => navigate('/profile')}>
            <div className="home-user-avatar">
              {avatarSrc ? <img src={avatarSrc} alt="" /> : firstChar}
            </div>
          </button>
        </div>
      </div>

      <div className="home-body">
        <div className="home-welcome">欢迎回来，{displayName}</div>
        <div className="home-subtitle">平台概览 — {dateStr}</div>

        <div className="kanban-grid">
          {updateStats(testTypes).map(t => {
            const isApi = t.key === 'api-test';
            const setsLabel = isApi ? '场景集' : '用例集';
            const scenariosLabel = isApi ? '场景' : '用例集';
            return (
            <div key={t.key} className="kanban-card" onClick={() => navigate(t.path)}>
              <div className="kanban-enter">
                <button className="kanban-enter-btn" onClick={(e) => { e.stopPropagation(); navigate(t.path); }}>进入系统 →</button>
              </div>
              <div className="kanban-icon" style={{ background: t.color, color: t.stroke }}>
                {t.icon}
              </div>
              <div className="kanban-name">{t.name}</div>
              <div className="kanban-desc">{t.desc}</div>
              <div className="kanban-stats">
                <div><div className="kanban-stat-val">{loading ? '-' : t.stats.cases}</div><div className="kanban-stat-label">用例总数</div></div>
                {isApi && (<div><div className="kanban-stat-val">{loading ? '-' : t.stats.scenarios}</div><div className="kanban-stat-label">{scenariosLabel}</div></div>)}
                <div><div className="kanban-stat-val">{loading ? '-' : t.stats.sets}</div><div className="kanban-stat-label">{setsLabel}</div></div>
              </div>
              <div className="kanban-rate">
                <div className="kanban-rate-bar">
                  <div className="kanban-rate-fill" style={{ width: `${t.stats.rate}%`, background: t.stats.rate >= 90 ? 'var(--success)' : 'var(--success)' }} />
                </div>
                <div className="kanban-rate-val" style={{ color: t.stats.rate >= 90 ? 'var(--success)' : 'var(--success)' }}>{t.stats.rate}%</div>
              </div>
            </div>
            );
          })}
        </div>

        <div className="home-bottom">
          <div className="home-panel">
            <div className="home-panel-head">最近活动</div>
            <div className="home-panel-body">
              {activities.length === 0 && !loading ? (
                <div className="activity-item">
                  <div className="activity-text" style={{ color: 'var(--fg-tertiary)' }}>暂无活动记录</div>
                </div>
              ) : (
                activities.map((a, i) => (
                  <div key={i} className="activity-item">
                    <div className="activity-dot" style={{ background: a.color }} />
                    <div className="activity-text">{a.text}</div>
                    <div className="activity-time">{a.time}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="home-panel">
            <div className="home-panel-head">快捷操作</div>
            <div className="shortcut-grid">
              {shortcuts.map((s, i) => (
                <button key={i} className="shortcut-btn" onClick={() => navigate(s.path)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}