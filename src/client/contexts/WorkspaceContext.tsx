import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiFetch, apiFetchCenter } from '../utils/api';
import { getTeamAuth, getLastCenterUrl } from '../utils/teamAuth';
import {
  readWorkspace,
  writeWorkspace,
  sanitizeWorkspace,
  WORKSPACE_CHANGED_EVENT,
  updateWorkspaceProject,
  readLastTeamSelection,
  writeLastTeamSelection,
  type Workspace,
} from '../utils/workspace';
import type { TeamSummary, ProjectInfo } from '../types/team';

/**
 * WorkspaceContext — observes the localStorage-backed workspace state and
 * provides switching APIs. The state itself lives in localStorage so the
 * plain-function api layer (utils/api.ts) reads it without React coupling;
 * this context listens to `workspace-changed` events and mirrors them for
 * component reactivity.
 */

interface WorkspaceContextType {
  workspace: Workspace;
  /** my teams at the connected center (team mode only, else []) */
  teams: TeamSummary[];
  teamsLoading: boolean;
  teamsError: string | null;
  /** projects of the active team (team mode only) */
  projects: ProjectInfo[];
  projectsLoading: boolean;
  switchToLocal: () => void;
  switchToTeam: (centerUrl: string, team: TeamSummary, project?: ProjectInfo | null) => void;
  selectProject: (project: ProjectInfo | null) => void;
  refreshTeams: (centerUrl?: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  /** center user when connected (team mode), else null */
  teamUser: { id: number; account: string; nickname: string | null } | null;
}

const WorkspaceContext = createContext<WorkspaceContextType>(null!);

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(() => sanitizeWorkspace());
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const teamUser =
    workspace.mode === 'team'
      ? (() => {
          const auth = getTeamAuth(workspace.centerUrl);
          return auth ? auth.user : null;
        })()
      : null;

  /**
   * Load my teams. Without argument: from the active team workspace, or clear
   * when in local mode. With an explicit centerUrl: fetch from that center
   * (used right after connect, before any workspace switch).
   */
  const refreshTeams = useCallback(async (centerUrl?: string) => {
    const explicit = centerUrl ?? null;
    const ws = readWorkspace();
    const url = explicit ?? (ws.mode === 'team' ? ws.centerUrl : null);
    if (!url) {
      setTeams([]);
      setTeamsError(null);
      return;
    }
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const res = explicit
        ? await apiFetchCenter<{ teams: TeamSummary[] }>(explicit, '/team/teams')
        : await apiFetch<{ teams: TeamSummary[] }>('/team/teams');
      const list = (res.data?.teams ?? []) as TeamSummary[];
      setTeams(list);
      // keep stored team name fresh
      const wsNow = readWorkspace();
      if (wsNow.mode === 'team' && wsNow.centerUrl === url) {
        const t = list.find((x) => x.id === wsNow.teamId);
        if (t && t.name !== wsNow.teamName) writeWorkspace({ ...wsNow, teamName: t.name });
      }
    } catch (e) {
      setTeamsError(e instanceof Error ? e.message : '加载团队失败');
      setTeams([]);
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    const ws = readWorkspace();
    if (ws.mode !== 'team') {
      setProjects([]);
      return;
    }
    setProjectsLoading(true);
    try {
      const res = await apiFetch<{ projects: ProjectInfo[] }>(`/team/teams/${ws.teamId}/projects`);
      setProjects((res.data?.projects ?? []) as ProjectInfo[]);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Mirror localStorage → state (covers cross-module writes & other tabs)
  useEffect(() => {
    const handler = () => setWorkspace(sanitizeWorkspace());
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // Load team lists: active team workspace → its center; local mode → last
  // connected center (if credentials survive), so the dropdown still offers
  // one-click re-entry after a page reload.
  useEffect(() => {
    if (workspace.mode === 'team') {
      void refreshTeams();
    } else {
      const last = getLastCenterUrl();
      if (last && getTeamAuth(last)) {
        void refreshTeams(last);
      } else {
        // 无中心会话: 清空团队/项目列表。否则本地登录/退出后, 旧团队列表
        // 残留在 React state 里被切换器渲染出来(用户报告: 本地登录后仍
        // 能看到上一个团队的团队名, 但点进去切换不了)。
        setTeams([]);
        setTeamsError(null);
        setProjects([]);
      }
    }
  }, [workspace.mode, workspace.mode === 'team' ? workspace.teamId : 0, refreshTeams]);

  useEffect(() => {
    if (workspace.mode === 'team') {
      void refreshProjects();
    } else {
      setProjects([]);
    }
  }, [workspace.mode, workspace.mode === 'team' ? workspace.teamId : 0, refreshProjects]);

  const switchToLocal = useCallback(() => {
    writeWorkspace({ mode: 'local' });
    setWorkspace({ mode: 'local' });
  }, []);

  const switchToTeam = useCallback((centerUrl: string, team: TeamSummary, project?: ProjectInfo | null) => {
    writeWorkspace({
      mode: 'team',
      centerUrl,
      teamId: team.id,
      teamName: team.name,
      projectId: project ? project.id : null,
      projectName: project ? project.name : null,
    });
    // 记住这次选择 — localStorage(本浏览器) + 中心库(跨设备漫游)双写。
    const sel = {
      centerUrl,
      teamId: team.id,
      teamName: team.name,
      projectId: project ? project.id : null,
      projectName: project ? project.name : null,
    };
    writeLastTeamSelection(sel);
    // fire-and-forget: 同步失败不影响切换, 本地记录仍兜底。
    void apiFetchCenter(centerUrl, '/team/auth/prefs/last-team', {
      method: 'PUT',
      body: JSON.stringify({ value: JSON.stringify(sel) }),
    }).catch(() => {});
    setWorkspace(readWorkspace());
  }, []);

  const selectProject = useCallback((project: ProjectInfo | null) => {
    updateWorkspaceProject(project);
    // 同步更新"上次选择"记录的项目部分（团队部分保持不变）。
    const last = readLastTeamSelection();
    const ws = readWorkspace();
    if (last && ws.mode === 'team' && ws.teamId === last.teamId) {
      const next = {
        ...last,
        projectId: project ? project.id : null,
        projectName: project ? project.name : null,
      };
      writeLastTeamSelection(next);
      void apiFetchCenter(ws.centerUrl, '/team/auth/prefs/last-team', {
        method: 'PUT',
        body: JSON.stringify({ value: JSON.stringify(next) }),
      }).catch(() => {});
    }
    setWorkspace(readWorkspace());
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        teams,
        teamsLoading,
        teamsError,
        projects,
        projectsLoading,
        switchToLocal,
        switchToTeam,
        selectProject,
        refreshTeams,
        refreshProjects,
        teamUser,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
