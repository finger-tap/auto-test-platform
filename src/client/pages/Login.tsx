import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetchCenter } from '../utils/api';
import { normalizeCenterUrl } from '../utils/teamAuth';
import { readLastTeamSelection } from '../utils/workspace';
import { notification } from '../utils/notification';
import type { TeamSummary, ProjectInfo } from '../types/team';
import './Auth.css';

// AutoTest Platform brand mark - inlined from public/brand/autotest-favicon.svg
// (64x64 viewBox, deep navy square + cyan wolf + green check). Sized to 24x24
// to fit the .auth-logo container; currentColor strokes inherit the
// container's text color so the icon adapts to dark/light theme.
const LogoSvg = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 64 64"
    role="img"
    aria-label="AutoTest Platform"
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d="M13 20 L23 8 L29 23 L35 23 L41 8 L51 20 L47 43 L34 57 L30 57 L17 43 Z" strokeWidth="4" />
    <circle cx="39" cy="31" r="7" strokeWidth="3" />
    <circle cx="39" cy="31" r="2" fill="currentColor" stroke="none" />
    <path d="M43 49 l4 4 8-10" stroke="#22C55E" strokeWidth="4" />
  </svg>
);

/**
 * 2026-08-23: 登录页支持两种账户类型（用户设计）：
 *   个人账户 -> 本实例 SQLite（个人空间）
 *   团队账户 -> 本部署的中心库（团队空间）-- 普通用户不再输入服务器地址
 * 团队账户登录后: 有团队直接进入第一个团队; 没有团队则引导用邀请码加入。
 */
export default function Login() {
  const [type, setType] = useState<'personal' | 'team'>(() =>
    new URLSearchParams(window.location.search).get('type') === 'team' ? 'team' : 'personal',
  );
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginCenter } = useAuth();
  const { switchToTeam } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  void useSearchParams(); // (react-router present; type read via URLSearchParams above)

  const afterTeamLogin = async () => {
    const origin = normalizeCenterUrl(window.location.origin);
    // 已登录团队账号: 有团队直接进第一个, 没有则去用邀请码/等管理员拉入
    try {
      const res = await apiFetchCenter<{ teams: TeamSummary[] }>(origin, '/team/teams');
      const teams = res.data?.teams ?? [];
      const from = (location.state as { from?: string } | null)?.from;
      if (teams.length > 0) {
        // 恢复上次选择的团队/项目 (2026-08-25): 优先级 中心库记录(跨设备)
        // > localStorage(本浏览器, 服务端不可达时兜底) > 第一个团队。上次的
        // 团队已被移出/解散时回落第一个团队, 上次的项目被删时回落第一个项目。
        // 团队资源接口全部要求项目上下文, 无项目可用时保持 null 并明确提示。
        let last = readLastTeamSelection();
        try {
          const pres = await apiFetchCenter<{ value: string | null }>(
            origin,
            '/team/auth/prefs/last-team',
          );
          if (pres.data?.value) {
            const parsed = JSON.parse(pres.data.value) as typeof last;
            if (parsed && typeof parsed.teamId === 'number') last = parsed;
          }
        } catch {
          /* 服务端偏好读取失败 — 用本浏览器记录兜底 */
        }
        const team =
          (last && last.centerUrl === origin ? teams.find((t) => t.id === last.teamId) : undefined) ??
          teams[0];
        let project: ProjectInfo | null = null;
        try {
          const pres = await apiFetchCenter<{ projects: ProjectInfo[] }>(
            origin,
            `/team/teams/${team.id}/projects`,
          );
          const projects = (pres.data?.projects ?? []) as ProjectInfo[];
          project =
            (last && last.teamId === team.id && last.projectId != null
              ? projects.find((p) => p.id === last.projectId)
              : undefined) ??
            projects[0] ??
            null;
        } catch {
          /* 项目列表拉取失败不阻塞登录, 保持无项目状态 */
        }
        switchToTeam(origin, team, project);
        notification.success(
          project ? `已进入团队「${team.name}」/ ${project.name}` : `已进入团队「${team.name}」`,
        );
        if (!project) {
          notification.info('该团队还没有项目 — 请在右上角切换器里先创建一个项目');
        }
      } else {
        notification.info('已登录团队账号；还没有团队 - 可通过邀请码加入，或联系管理员');
      }
      navigate(from || '/');
    } catch {
      // teams 拉取失败不阻塞登录
      navigate('/');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (type === 'personal') {
        await login(account, password);
        // Resume interrupted flows (e.g. invite-link /join/CODE bounced here)
        const from = (location.state as { from?: string } | null)?.from;
        navigate(from || '/');
      } else {
        await loginCenter(account, password);
        await afterTeamLogin();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <LogoSvg />
          </div>
          <div className="auth-title">AutoTest Platform</div>
          <div className="auth-subtitle">一站式自动化测试管理平台</div>
        </div>
        <div className="auth-body">
          <div className="auth-type-tabs">
            <button
              type="button"
              className={`auth-type-tab ${type === 'personal' ? 'active' : ''}`}
              onClick={() => { setType('personal'); setError(''); }}
            >
              👤 个人账户
            </button>
            <button
              type="button"
              className={`auth-type-tab ${type === 'team' ? 'active' : ''}`}
              onClick={() => { setType('team'); setError(''); }}
            >
              👥 团队账户
            </button>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            {type === 'team' && (
              <div className="auth-type-hint">团队账户存储在本平台的服务端，登录后进入团队协作空间</div>
            )}
            <div className="form-group">
              <label className="form-label">账号</label>
              <input
                type="text"
                placeholder="请输入账号"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {type === 'personal' && (
              <div className="auth-form-row">
                {/* "记住我"原是无任何效果的死 UI(remember 从未被消费), 已移除。
                    token 本就持久存于 localStorage, 无需勾选。 */}
                <span />
                <Link to="/forgot-password" className="auth-forgot">忘记密码？</Link>
              </div>
            )}
            <button className="auth-btn auth-btn-primary" type="submit" disabled={loading}>
              {loading ? '登录中...' : type === 'personal' ? '登 录' : '登录团队账户'}
            </button>
            <div className="auth-footer">
              <Link to={type === 'personal' ? '/register' : '/register?type=team'}>
                没有账号？立即注册{type === 'team' ? '团队账户' : ''}
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
