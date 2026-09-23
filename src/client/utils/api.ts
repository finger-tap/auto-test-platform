import type { ApiResponse, UserInfo } from '../types';
import { readWorkspace, writeWorkspace } from './workspace';
import { getTeamAuth, removeTeamAuth } from './teamAuth';
import { notification } from './notification';

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
function resolveTarget(path: string): { base: string; token: string | null; team: boolean; teamId?: number; projectId?: number; centerUrl?: string } {
  const ws = readWorkspace();
  if (ws.mode === 'team' && !isLocalOnly(path)) {
    const auth = getTeamAuth(ws.centerUrl);
    return {
      base: `${ws.centerUrl.replace(/\/+$/, '')}/api`,
      token: auth?.token ?? null,
      team: true,
      teamId: ws.teamId,
      projectId: ws.projectId ?? undefined,
      centerUrl: ws.centerUrl,
    };
  }
  return { base: API_BASE, token: getToken(), team: false };
}


/**
 * HTTP 状态语义判定 — 后端响应的 `code` 字段镜像 HTTP 状态码。
 * 用这些函数替代写死的 `code === 200` / `=== 201`, 让"成功"统一为 2xx。
 */
export function is2xx(code: unknown): boolean {
  const n = Number(code);
  return Number.isFinite(n) && n >= 200 && n < 300;
}
export function is4xx(code: unknown): boolean {
  const n = Number(code);
  return Number.isFinite(n) && n >= 400 && n < 500;
}
export function is5xx(code: unknown): boolean {
  const n = Number(code);
  return Number.isFinite(n) && n >= 500 && n < 600;
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
 * 团队会话失效（中心 token 过期/被拒）时的统一拆解。
 * 2026-08-25: 用户报告 token 24h 过期后刷新页面, 工作区仍停留在团队模式,
 * 所有团队请求 401 刷屏但什么都不清理 -- 页面渲染着"幽灵团队会话"
 * (centerUser 来自 localStorage 的陈旧 user 对象, 未经验证), 资源全部
 * 加载失败, 也没有任何路径回到登录页。
 *
 * 拆解动作（幂等, 并发 401 只弹一次提示）:
 *  1. 清掉该中心的过期凭据;
 *  2. 团队工作区退回个人空间（writeWorkspace 自带 workspace-changed 事件,
 *     WorkspaceContext/切换器随之刷新）;
 *  3. 派发 auth-changed 让 AuthContext 重读 centerUser（见其监听 effect）;
 *  4. 一次 toast 告知原因。
 *
 * 之后 ProtectedRoute 自然裁决: 本地会话仍有效 -> 留在个人空间继续干活;
 * 本地会话也无效 -> 跳登录页。这正是"过期超过 24h 应回登录页"的预期行为。
 */
let teamExpiryToastAt = 0;
function handleTeamSessionExpired(centerUrl?: string): void {
  if (centerUrl) removeTeamAuth(centerUrl);
  const ws = readWorkspace();
  if (ws.mode === 'team') writeWorkspace({ mode: 'local' });
  window.dispatchEvent(new Event('auth-changed'));
  const now = Date.now();
  if (now - teamExpiryToastAt > 3000) {
    teamExpiryToastAt = now;
    notification.error('团队登录已过期，请重新登录团队');
  }
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
      // 401 有两种截然不同的含义, 必须区分:
      //  a) 团队认证拒绝(需要团队登录/团队登录已失效) → 会话真过期 → 拆解;
      //  b) 本地路由被团队 token 误击中(如 /dashboard/*: 本地 JWT 验证,
      //     报 Authentication required) → token 类型不对, 会话没过期,
      //     拆解会把好端端的团队会话清掉 → 用户被误踢回登录页。
      const body = await res.json().catch(() => null) as ApiResponse<T> | null;
      const msg = body?.message || '';
      if (msg.includes('团队')) {
        handleTeamSessionExpired(target.centerUrl);
        return Promise.reject(new Error('团队登录已过期，请重新登录团队'));
      }
      throw new Error(msg || '请求失败 (401)');
    }
    removeToken();
    removeUserInfo();
    // Do NOT hard-redirect here — let the caller handle it (AuthContext
    // will set user=null → ProtectedRoute navigates to /login via React
    // Router, avoiding the infinite reload loop caused by
    // window.location.href on a page that itself triggers API calls).
    // 2026-08-25: 必须派发 auth-changed, 否则只清了 localStorage 而 React
    // 里的 user 还是旧对象 — ProtectedRoute 被幽灵会话骗过, 页面卡着不跳
    // 登录页(与团队 token 过期的同构问题对称修复)。
    window.dispatchEvent(new Event('auth-changed'));
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
  // 注意: 这里不做团队过期拆解 — blob 响应无法廉价区分"团队认证 401"和
  // "本地路由被团队 token 误击中的 401", 误拆会把好会话清掉。会话过期由
  // apiFetchJSON/apiFetchCenter 的精确判定兜底。
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
    window.dispatchEvent(new Event('auth-changed'));
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
    // 只有"带着已存 token 来访问却被团队认证拒绝"才意味着会话过期 —
    // 清理并退回个人空间。登录/注册接口本身不带 token（密码错误也 401）,
    // 以及本地路由的 Authentication required, 都不能误清理。
    const body = await res.json().catch(() => null) as ApiResponse<T> | null;
    if (auth?.token && (body?.message || '').includes('团队')) {
      handleTeamSessionExpired(centerUrl);
      return Promise.reject(new Error('团队登录已过期，请重新登录团队'));
    }
    return Promise.reject(new Error(body?.message || '请求失败 (401)'));
  }
  const body = await res.json().catch(() => null) as ApiResponse<T> | null;
  if (!body) throw new Error('服务器响应异常');
  if (!res.ok) throw new Error(body.message || `请求失败 (${res.status})`);
  return body;
}