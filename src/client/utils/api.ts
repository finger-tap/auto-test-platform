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

export async function apiFetch<T>(
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

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();
  return data;
}
