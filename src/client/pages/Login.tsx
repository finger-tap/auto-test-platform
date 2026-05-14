import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function Login() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, guestLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(account, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setError('');
    setLoading(true);
    try {
      await guestLogin();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <h2>Login</h2>
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="auth-error">{error}</div>}
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
          <label>Password</label>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
      <div className="auth-divider">
        <span>or</span>
      </div>
      <button className="auth-guest-btn" onClick={handleGuest} disabled={loading}>
        Guest Login
      </button>
      <div className="auth-footer">
        <Link to="/forgot-password">Forgot password?</Link>
        <span className="auth-footer-sep">|</span>
        <Link to="/register">Register</Link>
      </div>
    </div>
  );
}
