import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function ForgotPassword() {
  const [account, setAccount] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(account, newPassword);
      setSuccess('Password reset successfully! Redirecting to login...');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
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
          <div className="auth-title">重置密码</div>
          <div className="auth-subtitle">输入账号和新密码</div>
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
              <label className="form-label">新密码</label>
              <input type="password" placeholder="至少 6 位字符" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <input type="password" placeholder="再次输入新密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <button className="auth-btn auth-btn-primary" type="submit" disabled={loading}>
              {loading ? '重置中...' : '重置密码'}
            </button>
            <div className="auth-footer">
              <Link to="/login">返回登录</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
