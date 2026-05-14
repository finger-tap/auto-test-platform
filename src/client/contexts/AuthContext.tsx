import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, getToken, setToken, removeToken, getUserInfo, setUserInfo, removeUserInfo } from '../utils/api';
import type { UserInfo, LoginResponse } from '../types';

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  login: (account: string, password: string) => Promise<void>;
  register: (account: string, password: string, nickname?: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  logout: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (account: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = getUserInfo();
  const [user, setUser] = useState<UserInfo | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<UserInfo>('/auth/me')
      .then((res) => {
        if (res.code === 200 && res.data) {
          setUser(res.data);
          setUserInfo(res.data);
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

  const login = async (account: string, password: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    if (res.code !== 200) throw new Error(res.message);
    if (!res.data) throw new Error('No data returned');
    setToken(res.data.token);
    setUserInfo(res.data.user);
    setUser(res.data.user);
  };

  const register = async (account: string, password: string, nickname?: string) => {
    const res = await apiFetch<{ userId: number }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ account, password, nickname }),
    });
    if (res.code !== 201) throw new Error(res.message);
  };

  const guestLogin = async () => {
    const res = await apiFetch<LoginResponse>('/auth/guest', {
      method: 'POST',
    });
    if (res.code !== 200) throw new Error(res.message);
    if (!res.data) throw new Error('No data returned');
    setToken(res.data.token);
    setUserInfo(res.data.user);
    setUser(res.data.user);
  };

  const logout = () => {
    removeToken();
    removeUserInfo();
    setUser(null);
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    const res = await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    if (res.code !== 200) throw new Error(res.message);
  };

  const resetPassword = async (account: string, newPassword: string) => {
    const res = await apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ account, newPassword }),
    });
    if (res.code !== 200) throw new Error(res.message);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, guestLogin, logout, changePassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
