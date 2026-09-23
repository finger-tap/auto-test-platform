import type { TeamSummary, ProjectInfo } from '../types/team';
import { getTeamAuth } from './teamAuth';

/**
 * Workspace state — the single source of truth for "where do API requests go".
 *
 * - { mode: 'local' }               → all requests go to this origin (local instance)
 * - { mode: 'team', ... }           → all apiFetch requests go to the center server
 *
 * Persisted in localStorage (not React state) so the plain-function api layer
 * can read it without circular imports. React consumers observe changes via
 * the `workspace-changed` event / WorkspaceContext.
 */

export interface LocalWorkspace {
  mode: 'local';
}

export interface TeamWorkspace {
  mode: 'team';
  centerUrl: string;
  teamId: number;
  teamName: string;
  projectId: number | null;
  projectName: string | null;
}

export type Workspace = LocalWorkspace | TeamWorkspace;

const KEY = 'workspace';
export const WORKSPACE_CHANGED_EVENT = 'workspace-changed';

export function readWorkspace(): Workspace {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { mode: 'local' };
  try {
    const ws = JSON.parse(raw) as Workspace;
    if (ws && ws.mode === 'team') {
      const tw = ws as TeamWorkspace;
      if (typeof tw.centerUrl === 'string' && typeof tw.teamId === 'number') {
        return tw;
      }
    }
    if (ws && ws.mode === 'local') return { mode: 'local' };
  } catch {
    /* fallthrough */
  }
  return { mode: 'local' };
}

export function writeWorkspace(ws: Workspace): void {
  localStorage.setItem(KEY, JSON.stringify(ws));
  window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
}

/**
 * Downgrade to local if the persisted team workspace has no credentials
 * anymore (token removed / expired logout). Called by WorkspaceContext init.
 */
export function sanitizeWorkspace(): Workspace {
  const ws = readWorkspace();
  if (ws.mode === 'team') {
    const auth = getTeamAuth(ws.centerUrl);
    if (!auth) {
      writeWorkspace({ mode: 'local' });
      return { mode: 'local' };
    }
  }
  return ws;
}

export function workspaceLabel(ws: Workspace): string {
  if (ws.mode === 'local') return '个人空间';
  const proj = ws.projectName ? ` / ${ws.projectName}` : '';
  return `${ws.teamName}${proj}`;
}

/** Update the project part of the current team workspace (no-op in local). */
export function updateWorkspaceProject(project: ProjectInfo | null): Workspace {
  const ws = readWorkspace();
  if (ws.mode !== 'team') return ws;
  const next: TeamWorkspace = {
    ...ws,
    projectId: project ? project.id : null,
    projectName: project ? project.name : null,
  };
  writeWorkspace(next);
  return next;
}

/** Update team identity (after refreshTeams when names may change). */
export function updateWorkspaceTeamMeta(team: TeamSummary): void {
  const ws = readWorkspace();
  if (ws.mode !== 'team' || ws.teamId !== team.id) return;
  writeWorkspace({ ...ws, teamName: team.name });
}

/**
 * Last team/project selection — survives logout and re-login so the login
 * flow can restore it (2026-08-25: 用户报告每次登录都被切到第一个团队,
 * 上次手动选的团队/项目应被记住).
 *
 * Kept SEPARATE from the workspace entry on purpose: logout resets the
 * workspace to local mode, but this record must outlive that reset.
 */
export interface LastTeamSelection {
  centerUrl: string;
  teamId: number;
  teamName: string;
  projectId: number | null;
  projectName: string | null;
}

const LAST_TEAM_KEY = 'lastTeamSelection';

export function readLastTeamSelection(): LastTeamSelection | null {
  const raw = localStorage.getItem(LAST_TEAM_KEY);
  if (!raw) return null;
  try {
    const sel = JSON.parse(raw) as LastTeamSelection;
    if (
      typeof sel?.centerUrl === 'string' &&
      typeof sel?.teamId === 'number' &&
      (sel.projectId === null || typeof sel.projectId === 'number')
    ) {
      return sel;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export function writeLastTeamSelection(sel: LastTeamSelection): void {
  localStorage.setItem(LAST_TEAM_KEY, JSON.stringify(sel));
}
