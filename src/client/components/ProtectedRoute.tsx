import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute() {
  // 2026-08-23: 团队账号可独立登录使用平台（本地账号 OR 中心账号任一即可）。
  // 个人空间页面仍依赖本地身份；团队页由 workspace 模式路由中心请求。
  // 2026-08-25: HMR 热更新重挂载的瞬间 Provider 可能尚未就位, useAuth()
  // 返回默认 null — 直接解构会 TypeError 并把整棵 React 树打白屏,
  // 这里防御性兜底为 Loading。
  const auth = useAuth();
  if (!auth) {
    return <div style={{ textAlign: 'center', padding: '100px 0', color: '#999' }}>Loading...</div>;
  }
  const { user, centerUser, loading } = auth;

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '100px 0', color: '#999' }}>Loading...</div>;
  }

  if (!user && !centerUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
