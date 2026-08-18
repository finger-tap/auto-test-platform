import { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch } from '../utils/api';
import { removeTeamAuth, setLastCenterUrl, getLastCenterUrl } from '../utils/teamAuth';
import { workspaceLabel } from '../utils/workspace';
import { notification } from '../utils/notification';
import type { TeamSummary, ProjectInfo } from '../types/team';
import { TEAM_ROLE_LABELS } from '../types/team';
import ConnectTeamModal from './ConnectTeamModal';
import TeamOrgModal from './TeamOrgModal';
import TeamManageModal from './TeamManageModal';
import ImportToTeamModal from './ImportToTeamModal';
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
    setOpen(true);
    notification.success('已连接团队服务，请选择要进入的团队');
  };

  const pickProject = (project: ProjectInfo) => {
    selectProject(project);
    setOpen(false);
  };

  const createTeam = async (name: string, description: string) => {
    const res = await apiFetch<{ team: TeamSummary }>('/team/teams', {
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

  const disconnect = () => {
    if (workspace.mode !== 'team') return;
    removeTeamAuth(workspace.centerUrl);
    switchToLocal();
    setOpen(false);
    notification.success('已断开团队，回到个人空间');
  };

  const isTeamMode = workspace.mode === 'team';
  const activeTeamId = isTeamMode ? workspace.teamId : null;

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

          {/* actions */}
          {isTeamMode && (
            <button className="ws-item ws-action" onClick={() => setOrgModal({ mode: 'create-team' })}>
              ＋ 新建团队
            </button>
          )}
          {isTeamMode && workspace.projectId && (
            <button className="ws-item ws-action" onClick={() => { setOpen(false); setShowImport(true); }}>
              ⬆ 导入本机资源到当前项目…
            </button>
          )}
          {isTeamMode && (
            <button className="ws-item ws-action" onClick={() => { setOpen(false); setShowManage(true); }}>
              ⚙ 团队管理（成员 / 通知 / 审计）
            </button>
          )}
          <button className="ws-item ws-action" onClick={() => { setOpen(false); setShowConnect(true); }}>
            🔗 连接团队服务…
          </button>
          {isTeamMode && (
            <button className="ws-item ws-action ws-danger" onClick={disconnect}>
              断开团队（回到本地）
            </button>
          )}
        </div>
      )}

      {showConnect && (
        <ConnectTeamModal
          onClose={() => setShowConnect(false)}
          onConnected={handleConnected}
        />
      )}

      {orgModal && (
        <TeamOrgModal
          mode={orgModal.mode}
          onClose={() => setOrgModal(null)}
          onSubmit={orgModal.mode === 'create-team' ? createTeam : createProject}
        />
      )}

      {showManage && <TeamManageModal onClose={() => setShowManage(false)} />}
      {showImport && <ImportToTeamModal onClose={() => { setShowImport(false); }} />}
    </div>
  );
}
