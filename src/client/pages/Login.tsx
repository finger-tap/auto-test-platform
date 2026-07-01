import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

// AutoTest Platform brand mark — inlined from public/brand/autotest-favicon.svg
// (64x64 viewBox, deep navy square + cyan wolf + green check). Sized to 24x24
// to fit the .auth-logo container; currentColor strokes inherit the
// container's text color so the icon adapts to dark/light theme.
const LogoSvg = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 64 64"
    role="img"
    aria-label="AutoTest Platform"
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d="M13 20 L23 8 L29 23 L35 23 L41 8 L51 20 L47 43 L34 57 L30 57 L17 43 Z" strokeWidth="4" />
    <circle cx="39" cy="31" r="7" strokeWidth="3" />
    <circle cx="39" cy="31" r="2" fill="currentColor" stroke="none" />
    <path d="M43 49 l4 4 8-10" stroke="#22C55E" strokeWidth="4" />
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
          <div className="auth-title">AutoTest Platform</div>
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
