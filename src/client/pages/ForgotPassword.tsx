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
    <div className="auth-card">
      <h2>Reset Password</h2>
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}
        <div className="form-item">
          <label>Account</label>
          <input
            type="text"
            placeholder="Email or phone number"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
          />
        </div>
        <div className="form-item">
          <label>New Password</label>
          <input
            type="password"
            placeholder="At least 6 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <div className="form-item">
          <label>Confirm New Password</label>
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
      <div className="auth-footer">
        <Link to="/login">Back to Login</Link>
      </div>
    </div>
  );
}
