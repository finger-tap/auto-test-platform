import { useState, useRef, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function Register() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await register(account, password, nickname.trim() || undefined, avatarFile || undefined);
      setSuccess('Registration successful! Redirecting to login...');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M9 3L5 7l4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 3l4 4-4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 7l-2 10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <div className="auth-title">注册账号</div>
          <div className="auth-subtitle">创建你的 Auto Test Platform 账号</div>
        </div>
        <div className="auth-body">
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <div className="form-group">
              <label className="form-label">账号</label>
              <input type="text" placeholder="请输入账号" value={account} onChange={(e) => setAccount(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">昵称（选填）</label>
              <input type="text" placeholder="留空则使用账号前3位" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <input type="password" placeholder="至少 6 位字符" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">确认密码</label>
              <input type="password" placeholder="再次输入密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <button className="auth-btn auth-btn-primary" type="submit" disabled={loading}>
              {loading ? '注册中...' : '注 册'}
            </button>
            <div className="auth-footer">
              已有账号？<Link to="/login">立即登录</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
