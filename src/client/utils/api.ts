import type { ApiResponse, UserInfo } from '../types';

const API_BASE = '/api';

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
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    removeToken();
    removeUserInfo();
    // Do NOT hard-redirect here — let the caller handle it (AuthContext
    // will set user=null → ProtectedRoute navigates to /login via React
    // Router, avoiding the infinite reload loop caused by
    // window.location.href on a page that itself triggers API calls).
    return Promise.reject(new Error('登录已过期，请重新登录'));
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
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

/** Legacy alias — now delegates to apiFetchJSON for backwards compat */
export const apiFetch = apiFetchJSON;