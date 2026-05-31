import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { changePassword, logout } = useAuth();
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
      await changePassword(oldPassword, newPassword);
      setSuccess('Password changed successfully. Please login again.');
      setTimeout(() => {
        logout();
        navigate('/login');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '40px auto' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px', boxShadow: 'var(--shadow-md)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>修改密码</h2>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <div className="form-group">
            <label className="form-label">当前密码</label>
            <input type="password" placeholder="请输入当前密码" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
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
            {loading ? '修改中...' : '修改密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
