import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

const LogoSvg = () => (
  <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
    <path d="M9 3L5 7l4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 3l4 4-4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M13 7l-2 10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export default function Login() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(account, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <LogoSvg />
          </div>
          <div className="auth-title">Auto Test Platform</div>
          <div className="auth-subtitle">一站式自动化测试管理平台</div>
        </div>
        <div className="auth-body">
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">账号</label>
              <input
                type="text"
                placeholder="请输入账号"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="auth-form-row">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                记住我
              </label>
              <Link to="/forgot-password" className="auth-forgot">忘记密码？</Link>
            </div>
            <button className="auth-btn auth-btn-primary" type="submit" disabled={loading}>
              {loading ? '登录中...' : '登 录'}
            </button>
            <div className="auth-footer">
              <Link to="/register">没有账号？立即注册</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
