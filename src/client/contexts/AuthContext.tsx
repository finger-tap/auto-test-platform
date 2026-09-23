import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetchCenter, apiFetchLocal, getToken, setToken, removeToken, getUserInfo, setUserInfo, removeUserInfo, is2xx } from '../utils/api';
import {
  clearAllTeamAuth,
  getTeamAuth,
  getLastCenterUrl,
  setLastCenterUrl,
  setTeamAuth,
  normalizeCenterUrl,
} from '../utils/teamAuth';
import { writeWorkspace } from '../utils/workspace';
import type { UserInfo, LoginResponse } from '../types';
import type { TeamUserInfo, TeamCreatePolicy } from '../types/team';

/**
 * 会话互斥原则 (2026-08-23, 修复用户报告的残留 bug):
 * 登录哪种账户类型, 就进入哪种空间; 另一类会话无条件清除。
 * 之前的"仅换本地账号时清理"存在漏洞 -- 团队账户登录(不退出)后再登录
 * 本地账户, 团队凭据与团队工作区状态被原样继承, 用户看到上一个团队
 * 账号留下的团队信息。互斥后语义清晰: 要团队空间就(重新)登录团队账户。
 */
function enterLocalSession(): void {
  clearAllTeamAuth();
  writeWorkspace({ mode: 'local' });
}

function enterTeamSession(centerUrl: string, auth: { token: string; user: TeamUserInfo; createPolicy?: TeamCreatePolicy }): void {
  clearAllTeamAuth();
  setTeamAuth(centerUrl, auth);
  setLastCenterUrl(centerUrl);
  // 先回到个人空间, 由调用方(登录页)在确认有所属团队后再切换进团队;
  // 避免新团队账号无团队时残留上一个账号的团队工作区。
  writeWorkspace({ mode: 'local' });
}

interface AuthContextType {
  user: UserInfo | null;
  /** center (team) account when its session exists in this browser, else null */
  centerUser: TeamUserInfo | null;
  /** either session is enough to use the app (2026-08-23 team-account login) */
  authenticated: boolean;
  loading: boolean;
  login: (account: string, password: string) => Promise<void>;
  /** login a TEAM account against this deployment's center (origin) */
  loginCenter: (account: string, password: string) => Promise<void>;
  register: (account: string, password: string, nickname?: string, avatarFile?: File) => Promise<void>;
  /** register a TEAM account on this deployment's center, then auto-login */
  registerCenter: (account: string, password: string, nickname?: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  logout: () => void;
  updateUser: (user: UserInfo) => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = getUserInfo();
  const [user, setUser] = useState<UserInfo | null>(cached);
  // Center session (team account) lives in teamAuth:<origin>; mirrored here so
  // the whole app (ProtectedRoute, UserMenu...) can rely on one auth context.
  const [centerUser, setCenterUser] = useState<TeamUserInfo | null>(() => {
    const last = getLastCenterUrl();
    return last ? (getTeamAuth(last)?.user ?? null) : null;
  });
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetchLocal<UserInfo>('/auth/me')
      .then((res) => {
        const r = res as { code?: number; data?: UserInfo };
        if (is2xx(r.code) && r.data) {
          setUser(r.data);
          setUserInfo(r.data);
        } else {
          removeToken();
          removeUserInfo();
          setUser(null);
        }
      })
      .catch(() => {
        removeToken();
        removeUserInfo();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // 2026-08-25: 监听 auth-changed, 让 centerUser 始终镜像 teamAuth 存储。
  // 此前外部清理（api.ts 里团队 token 过期的拆解: removeTeamAuth + 退出团队
  // 工作区）只改 localStorage, React 里的 centerUser 还是陈旧对象 ——
  // ProtectedRoute 被幽灵会话骗过, 页面渲染出来但所有团队请求 401。
  // 登录/登出动作自身派发的 auth-changed 也会经过这里, 读取结果与它们
  // 刚写入的 localStorage 一致, 无副作用。
  useEffect(() => {
    const syncCenterUser = () => {
      const last = getLastCenterUrl();
      setCenterUser(last ? (getTeamAuth(last)?.user ?? null) : null);
      // 本地 token 被 api.ts 的 401 路径拆解时(只清 localStorage), React 里
      // 的 user 还是旧对象 — 同步置空, 让 ProtectedRoute 正确跳转登录页。
      if (!getToken()) setUser(null);
    };
    window.addEventListener('auth-changed', syncCenterUser);
    return () => window.removeEventListener('auth-changed', syncCenterUser);
  }, []);

  const login = async (account: string, password: string) => {
    const res = await apiFetchLocal<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    }) as { code: number; message?: string; data?: LoginResponse };
    if (!is2xx(res.code)) throw new Error(res.message);
    if (!res.data) throw new Error('No data returned');
    enterLocalSession();
    setCenterUser(null);
    setToken(res.data.token);
    setUserInfo(res.data.user);
    setUser(res.data.user);
    window.dispatchEvent(new Event('auth-changed'));
  };

  const register = async (account: string, password: string, nickname?: string, avatarFile?: File) => {
    if (avatarFile) {
      const formData = new FormData();
      formData.append('account', account);
      formData.append('password', password);
      if (nickname) formData.append('nickname', nickname);
      formData.append('avatar', avatarFile);
      const token = getToken();
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json() as { code: number; message?: string };
      if (!is2xx(data.code)) throw new Error(data.message);
    } else {
      const res = await apiFetchLocal<{ userId: number }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ account, password, nickname }),
      }) as { code: number; message?: string; data?: { userId: number } };
      if (!is2xx(res.code)) throw new Error(res.message);
    }
  };

  const guestLogin = async () => {
    const res = await apiFetchLocal<LoginResponse>('/auth/guest', {
      method: 'POST',
    }) as { code: number; message?: string; data?: LoginResponse };
    if (!is2xx(res.code)) throw new Error(res.message);
    if (!res.data) throw new Error('No data returned');
    enterLocalSession();
    setCenterUser(null);
    setToken(res.data.token);
    setUserInfo(res.data.user);
    setUser(res.data.user);
    window.dispatchEvent(new Event('auth-changed'));
  };

  /** Login a TEAM account against THIS deployment's center (window origin).
   *  Normal users never type a server address - the deployed app is the center. */
  const loginCenter = async (account: string, password: string) => {
    const origin = normalizeCenterUrl(window.location.origin);
    const res = await apiFetchCenter<{ token: string; user: TeamUserInfo; createPolicy?: TeamCreatePolicy }>(
      origin,
      '/team/auth/login',
      { method: 'POST', body: JSON.stringify({ account, password }) },
    );
    const d = res.data;
    if (!d?.token || !d.user) throw new Error('登录失败');
    enterTeamSession(origin, { token: d.token, user: d.user, createPolicy: d.createPolicy });
    setCenterUser(d.user);
    window.dispatchEvent(new Event('auth-changed'));
  };

  /** Register a TEAM account on this deployment's center, then auto-login. */
  const registerCenter = async (account: string, password: string, nickname?: string) => {
    const origin = normalizeCenterUrl(window.location.origin);
    const res = await apiFetchCenter<{ token?: string; user?: TeamUserInfo; createPolicy?: TeamCreatePolicy }>(
      origin,
      '/team/auth/register',
      { method: 'POST', body: JSON.stringify({ account, password, nickname }) },
    );
    // register returns user without token - login right after
    await loginCenter(account, password);
  };

  const logout = () => {
    removeToken();
    removeUserInfo();
    setUser(null);
    // 本地退出 => 中心会话同步终止, 工作区回到个人空间
    clearAllTeamAuth();
    writeWorkspace({ mode: 'local' });
    setCenterUser(null);
  };

  const updateUser = (u: UserInfo) => {
    setUser(u);
    setUserInfo(u);
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    const res = await apiFetchLocal('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }) as { code: number; message?: string };
    if (!is2xx(res.code)) throw new Error(res.message);
  };

  const resetPassword = async (oldPassword: string, newPassword: string) => {
    const res = await apiFetchLocal('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }) as { code: number; message?: string };
    if (!is2xx(res.code)) throw new Error(res.message);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        centerUser,
        authenticated: !!user || !!centerUser,
        loading,
        login,
        loginCenter,
        register,
        registerCenter,
        guestLogin,
        logout,
        updateUser,
        changePassword,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}