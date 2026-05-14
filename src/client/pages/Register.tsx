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
    <div className="auth-card">
      <h2>Register</h2>
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        {/* Avatar upload */}
        <div className="reg-avatar-row">
          <div className="reg-avatar" onClick={() => fileRef.current?.click()}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="" />
            ) : (
              <span className="reg-avatar-placeholder">+</span>
            )}
          </div>
          <div className="reg-avatar-text">
            <button type="button" className="reg-avatar-btn" onClick={() => fileRef.current?.click()}>
              {avatarPreview ? '更换头像' : '上传头像'}
            </button>
            <span className="reg-avatar-hint">不上传将自动生成像素头像</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>

        <div className="form-item">
          <label>Account</label>
          <input type="text" placeholder="Email or phone number" value={account} onChange={(e) => setAccount(e.target.value)} required />
        </div>
        <div className="form-item">
          <label>Nickname (optional)</label>
          <input type="text" placeholder="Leave blank to use first 3 chars of account" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="form-item">
          <label>Password</label>
          <input type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="form-item">
          <label>Confirm Password</label>
          <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>
      <div className="auth-footer">
        Already have an account? <Link to="/login">Login</Link>
      </div>
    </div>
  );
}
