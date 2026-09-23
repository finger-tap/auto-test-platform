import { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch, apiFetchCenter, getToken } from '../utils/api';
import { setLastCenterUrl, getLastCenterUrl, getTeamAuth } from '../utils/teamAuth';
import { workspaceLabel } from '../utils/workspace';
import { notification } from '../utils/notification';
import type { TeamSummary, ProjectInfo } from '../types/team';
import { TEAM_ROLE_LABELS } from '../types/team';
import ConnectTeamModal from './ConnectTeamModal';
import TeamOrgModal from './TeamOrgModal';
import TeamManageModal from './TeamManageModal';
import ImportToTeamModal from './ImportToTeamModal';
import RedeemInviteModal from './RedeemInviteModal';
import './WorkspaceSwitcher.css';

/**
 * Header workspace switcher:
 *   [ 个人空间 / 团队 / 项目  ▾ ]
 *     ├ 个人空间（本地）
 *     ├ team A（角色）▸ 项目列表
 *     ├ team B ...
 *     ├ + 新建团队 / 连接团队服务
 *     └ （team 模式）断开团队
 */

export default function WorkspaceSwitcher() {
  const {
    workspace,
    teams,
    teamsLoading,
    teamsError,
    projects,
    projectsLoading,
    selectProject,
    switchToLocal,
    switchToTeam,
    refreshTeams,
    refreshProjects,
    teamUser,
  } = useWorkspace();

  const [open, setOpen] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<number | null>(
    workspace.mode === 'team' ? workspace.teamId : null,
  );
  const [showConnect, setShowConnect] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  // 连接向导恢复邀请码流程时暂存 code — 不能只靠 pendingInviteCode:
  // handleConnected 会把它清掉, 而弹窗的 initialCode 在下一轮渲染才读取
  const [redeemInitialCode, setRedeemInitialCode] = useState<string | undefined>(undefined);
  const [orgModal, setOrgModal] = useState<null | { mode: 'create-team' } | { mode: 'create-project'; teamId: number }>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const enterTeam = (team: TeamSummary, project?: ProjectInfo | null) => {
    switchToTeam(currentCenterUrl(), team, project);
    setExpandedTeam(team.id);
    setOpen(false);
  };

  const currentCenterUrl = (): string => {
    if (workspace.mode === 'team') return workspace.centerUrl;
    return getLastCenterUrl() || '';
  };

  const handleConnected = (_auth: { user: { account: string } }, url: string) => {
    setLastCenterUrl(url);
    setShowConnect(false);
    void refreshTeams(url);
    if (pendingInviteCode) {
      // Invite-link flow: credentials are in place - go redeem right away.
      const code = pendingInviteCode;
      setPendingInviteCode(null);
      setConnectInitialUrl(undefined);
      setRedeemInitialCode(code);
      setShowRedeem(true);
      return;
    }
    setOpen(true);
    notification.success('已连接团队服务，请选择要进入的团队');
  };

  /** Invite-code entry: requires center credentials; otherwise connect first. */
  const openRedeem = () => {
    setOpen(false);
    const url = currentCenterUrl();
    if (url && getTeamAuth(url)) {
      setShowRedeem(true);
    } else {
      // No center session yet - the login page's team tab creates one.
      window.location.href = '/login?type=team';
    }
  };

  /** Link pointed at a center we have no credentials for: connect, then resume. */
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const needConnectForInvite = (url: string, code: string) => {
    setShowRedeem(false);
    setPendingInviteCode(code);
    setConnectInitialUrl(url);
    setShowConnect(true);
  };

  /** initialUrl override for the connect wizard (invite-link flow). */
  const [connectInitialUrl, setConnectInitialUrl] = useState<string | undefined>(undefined);

  const handleJoined = async (team: TeamSummary) => {
    setShowRedeem(false);
    await refreshTeams();
    enterTeam(team, null);
  };

  const pickProject = (project: ProjectInfo) => {
    selectProject(project);
    setOpen(false);
  };

  const createTeam = async (name: string, description: string) => {
    const url = currentCenterUrl();
    if (!url) {
      notification.error('请先连接团队服务');
      return;
    }
    // apiFetchCenter: this can be triggered while still in LOCAL workspace
    // (fresh user, no teams yet) - plain apiFetch would hit the wrong target.
    const res = await apiFetchCenter<{ team: TeamSummary }>(url, '/team/teams', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    const team = res.data?.team;
    setOrgModal(null);
    await refreshTeams();
    if (team) {
      // refreshTeams is async state — switch with the local object directly
      enterTeam(team, null);
      notification.success(`团队「${team.name}」已创建`);
    }
  };

  const createProject = async (name: string, description: string) => {
    if (orgModal?.mode !== 'create-project') return;
    const teamId = orgModal.teamId;
    const res = await apiFetch<{ project: ProjectInfo }>(`/team/teams/${teamId}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    const project = res.data?.project;
    setOrgModal(null);
    await refreshProjects();
    if (project) {
      pickProject(project);
      notification.success(`项目「${project.name}」已创建`);
    }
  };

  const isTeamMode = workspace.mode === 'team';
  const activeTeamId = isTeamMode ? workspace.teamId : null;

  // Center credentials exist (connected) even if we sit in local workspace -
  // e.g. right after connect with zero teams. Used for entry visibility.
  const lastUrl = currentCenterUrl();
  const centerAuth = lastUrl ? getTeamAuth(lastUrl) : null;
  const canCreateTeam =
    !!centerAuth &&
    (centerAuth.createPolicy === 'self' || centerAuth.user.isPlatformAdmin === 1);

  return (
    <div className="ws-switcher" ref={rootRef}>
      <button
        className="ws-trigger"
        onClick={() => setOpen(!open)}
        title={isTeamMode ? `${workspace.centerUrl} · ${workspaceLabel(workspace)}` : '当前：个人空间（本地）'}
      >
        <span className={`ws-mode-dot ${isTeamMode ? 'team' : 'local'}`} />
        <span className="ws-trigger-label">{workspaceLabel(workspace)}</span>
        {teamUser && (
          <span className="ws-trigger-user">{teamUser.nickname || teamUser.account}</span>
        )}
        <span className="ws-caret">▾</span>
      </button>

      {open && (
        <div className="ws-dropdown">
          {/* personal space */}
          <button
            className={`ws-item ${!isTeamMode ? 'active' : ''}`}
            onClick={() => {
              // 团队账户独立登录(无本地会话)时, 引导去登录个人账户
              if (!getToken()) {
                setOpen(false);
                window.location.href = '/login';
                return;
              }
              switchToLocal();
              setOpen(false);
            }}
          >
            <span className="ws-mode-dot local" />
            <span className="ws-item-name">个人空间</span>
            <span className="ws-item-hint">本地存储</span>
          </button>

          <div className="ws-sep" />

          {/* teams */}
          {teamsLoading && <div className="ws-loading">加载团队中…</div>}
          {teamsError && <div className="ws-error">{teamsError}</div>}
          {!teamsLoading && !teamsError && teams.length === 0 && isTeamMode === false && (
            <div className="ws-empty">尚未加入任何团队</div>
          )}

          {teams.map((team) => {
            const expanded = expandedTeam === team.id;
            const isActive = activeTeamId === team.id;
            return (
              <div key={team.id} className={`ws-team ${isActive ? 'active' : ''}`}>
                <div className="ws-team-row">
                  <button
                    className="ws-team-main"
                    onClick={() => (isActive ? setExpandedTeam(expanded ? null : team.id) : enterTeam(team))}
                    title={team.description || team.name}
                  >
                    <span className="ws-mode-dot team" />
                    <span className="ws-item-name">{team.name}</span>
                    <span className="ws-role-badge">{TEAM_ROLE_LABELS[team.role]}</span>
                  </button>
                  <button
                    className={`ws-team-expand ${expanded ? 'open' : ''}`}
                    title="选择项目"
                    onClick={() => setExpandedTeam(expanded ? null : team.id)}
                  >
                    ▸
                  </button>
                </div>
                {expanded && (
                  <div className="ws-projects">
                    <button
                      className={`ws-project ${isActive && isTeamMode && workspace.projectId === null ? 'active' : ''}`}
                      onClick={() => {
                        if (isActive) selectProject(null);
                        else enterTeam(team, null);
                        setOpen(false);
                      }}
                    >
                      （项目全部 / 未指定）
                    </button>
                    {(isActive ? projects : []).map((p) => (
                      <button
                        key={p.id}
                        className={`ws-project ${isActive && isTeamMode && workspace.projectId === p.id ? 'active' : ''}`}
                        onClick={() => {
                          if (isActive) pickProject(p);
                          else enterTeam(team, p);
                        }}
                      >
                        {p.name}
                      </button>
                    ))}
                    {isActive && projects.length === 0 && !projectsLoading && (
                      <div className="ws-empty">暂无项目</div>
                    )}
                    {isActive && (
                      <button
                        className="ws-new-project"
                        onClick={() => setOrgModal({ mode: 'create-project', teamId: team.id })}
                      >
                        ＋ 新建项目
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="ws-sep" />

          {/* 2026-08-23 简化: 切换器只做"切换", 管理动作都在团队管理弹窗里。
              有中心会话 -> 邀请码入口; 没有 -> 团队账户登录入口。 */}
          {centerAuth ? (
            <button className="ws-item ws-action" onClick={openRedeem}>
              🎟 用邀请码加入团队…
            </button>
          ) : (
            <button className="ws-item ws-action" onClick={() => { setOpen(false); window.location.href = '/login?type=team'; }}>
              👥 登录团队账户…
            </button>
          )}
          {canCreateTeam && (
            <button className="ws-item ws-action" onClick={() => setOrgModal({ mode: 'create-team' })}>
              ＋ 新建团队
            </button>
          )}
          {isTeamMode && (
            <button className="ws-item ws-action" onClick={() => { setOpen(false); setShowManage(true); }}>
              ⚙ 团队管理（成员 / 邀请码 / 数据 / 审计）
            </button>
          )}
        </div>
      )}

      {showConnect && (
        <ConnectTeamModal
          initialUrl={connectInitialUrl}
          onClose={() => { setShowConnect(false); setPendingInviteCode(null); setConnectInitialUrl(undefined); }}
          onConnected={handleConnected}
        />
      )}

      {showRedeem && currentCenterUrl() && (
        <RedeemInviteModal
          centerUrl={currentCenterUrl()}
          initialCode={redeemInitialCode ?? pendingInviteCode ?? undefined}
          onClose={() => { setShowRedeem(false); setPendingInviteCode(null); setRedeemInitialCode(undefined); }}
          onJoined={(t) => void handleJoined(t)}
          onNeedConnect={needConnectForInvite}
        />
      )}

      {orgModal && (
        <TeamOrgModal
          mode={orgModal.mode}
          onClose={() => setOrgModal(null)}
          onSubmit={orgModal.mode === 'create-team' ? createTeam : createProject}
        />
      )}

      {showManage && (
        <TeamManageModal
          onClose={() => setShowManage(false)}
          onOpenImport={(mode) => {
            setShowManage(false);
            if (mode === 'pick-account') setShowSync(true);
            else setShowImport(true);
          }}
        />
      )}
      {showImport && <ImportToTeamModal onClose={() => { setShowImport(false); }} />}

      {/* 2026-08-23: 选任意本地账号的数据同步进团队项目（用户设计） */}
      {showSync && <ImportToTeamModal mode="pick-account" onClose={() => { setShowSync(false); }} />}
    </div>
  );
}
