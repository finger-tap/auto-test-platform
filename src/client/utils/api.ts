import type { ApiResponse, UserInfo } from '../types';
import { readWorkspace } from './workspace';
import { getTeamAuth } from './teamAuth';

const API_BASE = '/api';

/**
 * Endpoints that must ALWAYS hit the LOCAL instance with the LOCAL token,
 * regardless of workspace: identity management (the local account is who
 * you are on this machine), per-user local prefs/model/browser configs,
 * avatar serving. Prevents a persisted team workspace from breaking login.
 */
const LOCAL_ONLY_PREFIXES = [
  '/auth/',
  '/midscene-config',
  '/web-browser-config',
  '/user-preferences',
  '/export-package',
];

function isLocalOnly(path: string): boolean {
  return LOCAL_ONLY_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
}

/**
 * Where should this request go + which token to attach?
 * team workspace → center server absolute URL + center token + team ctx headers.
 * local workspace → same-origin relative URL + local token (existing behavior).
 */
function resolveTarget(path: string): { base: string; token: string | null; team: boolean; teamId?: number; projectId?: number } {
  const ws = readWorkspace();
  if (ws.mode === 'team' && !isLocalOnly(path)) {
    const auth = getTeamAuth(ws.centerUrl);
    return {
      base: `${ws.centerUrl.replace(/\/+$/, '')}/api`,
      token: auth?.token ?? null,
      team: true,
      teamId: ws.teamId,
      projectId: ws.projectId ?? undefined,
    };
  }
  return { base: API_BASE, token: getToken(), team: false };
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string): void {
  localStorage.setItem('token', token);
}

export function removeToken(): void {
  localStorage.removeItem('token');
}

export function getUserInfo(): UserInfo | null {
  const raw = localStorage.getItem('userInfo');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUserInfo(user: UserInfo): void {
  localStorage.setItem('userInfo', JSON.stringify(user));
}

export function removeUserInfo(): void {
  localStorage.removeItem('userInfo');
}

/**
 * Standard JSON API call — always returns parsed JSON response.
 * Use this for normal API requests (not file uploads or downloads).
 */
export async function apiFetchJSON<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const target = resolveTarget(path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (target.token) {
    headers['Authorization'] = `Bearer ${target.token}`;
  }
  // Team context for the center resource dispatcher.
  if (target.team) {
    if (target.teamId) headers['X-Team-Id'] = String(target.teamId);
    if (target.projectId) headers['X-Project-Id'] = String(target.projectId);
  }

  const res = await fetch(`${target.base}${path}`, { ...options, headers });
  if (res.status === 401) {
    if (target.team) {
      // Center token expired — surface a team-specific message. The
      // WorkspaceContext surfaces a reconnect prompt; we must NOT clear the
      // LOCAL token here (that would log the user out of the local app).
      return Promise.reject(new Error('团队登录已过期，请重新连接团队'));
    }
    removeToken();
    removeUserInfo();
    // Do NOT hard-redirect here — let the caller handle it (AuthContext
    // will set user=null → ProtectedRoute navigates to /login via React
    // Router, avoiding the infinite reload loop caused by
    // window.location.href on a page that itself triggers API calls).
    return Promise.reject(new Error('登录已过期，请重新登录'));
  }
  if (res.status === 409) {
    // Optimistic-lock conflict — broadcast so the global conflict banner can
    // offer "load latest". Body still flows to the caller for inline handling.
    const body = (await res.clone().json().catch(() => null)) as ApiResponse<T> & {
      data?: { conflict?: boolean; currentVersion?: number };
    } | null;
    if (body?.data?.conflict) {
      window.dispatchEvent(
        new CustomEvent('team-conflict', { detail: { message: body.message || '资源已被他人修改' } }),
      );
    }
    if (!body) throw new Error('服务器响应异常');
    return body;
  }

  const body = await res.json().catch(() => null) as ApiResponse<T> | null;
  if (!body) {
    throw new Error('服务器响应异常');
  }
  if (!res.ok) {
    throw new Error(body.message || `请求失败 (${res.status})`);
  }
  return body;
}

/**
 * Download blob — use for file downloads.
 */
export async function apiFetchBlob(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const target = resolveTarget(path);
  const headers: Record<string, string> = {};
  if (target.token) {
    headers['Authorization'] = `Bearer ${target.token}`;
  }
  if (target.team) {
    if (target.teamId) headers['X-Team-Id'] = String(target.teamId);
    if (target.projectId) headers['X-Project-Id'] = String(target.projectId);
  }
  return fetch(`${target.base}${path}`, { ...options, headers });
}

/** Always-local request — identity endpoints etc., never rerouted to center. */
export async function apiFetchLocal<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    removeToken();
    removeUserInfo();
    return Promise.reject(new Error('登录已过期，请重新登录'));
  }
  const body = await res.json().catch(() => null) as ApiResponse<T> | null;
  if (!body) throw new Error('服务器响应异常');
  if (!res.ok) throw new Error(body.message || `请求失败 (${res.status})`);
  return body;
}

/** Legacy alias — now delegates to apiFetchJSON for backwards compat */
export const apiFetch = apiFetchJSON;

/**
 * Explicit-center request — used when credentials exist but the workspace is
 * not (yet) in team mode (e.g. right after a successful connect, listing
 * teams to pick). Routes to the given center URL with ITS token.
 */
export async function apiFetchCenter<T>(
  centerUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const auth = getTeamAuth(centerUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (auth?.token) headers['Authorization'] = `Bearer ${auth.token}`;

  const res = await fetch(`${centerUrl.replace(/\/+$/, '')}/api${path}`, { ...options, headers });
  if (res.status === 401) {
    return Promise.reject(new Error('团队登录已过期，请重新连接团队'));
  }
  const body = await res.json().catch(() => null) as ApiResponse<T> | null;
  if (!body) throw new Error('服务器响应异常');
  if (!res.ok) throw new Error(body.message || `请求失败 (${res.status})`);
  return body;
}