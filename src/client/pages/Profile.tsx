import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, getToken, setUserInfo } from '../utils/api';
import type { UserInfo } from '../types';
import './Profile.css';

export default function Profile() {
  const { user, logout } = useAuth();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setAvatarPreview(user.avatar || '');
    }
  }, [user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      // Upload avatar first if changed
      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        const token = getToken();
        const res = await fetch('/api/auth/avatar', {
          method: 'POST',
          body: formData,
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.code === 200 && data.data) {
          setUserInfo(data.data);
          setAvatarPreview(data.data.avatar || '');
          setAvatarFile(null);
        }
      }

      // Update profile info
      const res = await apiFetch<UserInfo>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ nickname: nickname.trim() || null, email: email.trim() || null, phone: phone.trim() || null }),
      });
      if (res.code === 200 && res.data) {
        setUserInfo(res.data);
        setMessage('保存成功');
      }
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const displayName = user?.nickname || user?.account?.slice(0, 3) || 'U';
  const firstChar = displayName.charAt(0).toUpperCase();

  return (
    <div className="profile-page">
      <h3>个人信息</h3>
      <form className="profile-form" onSubmit={handleSave}>
        {/* Avatar */}
        <div className="profile-avatar-row">
          <div className="profile-avatar" onClick={() => fileRef.current?.click()}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="" />
            ) : (
              <span className="profile-avatar-ph">{firstChar}</span>
            )}
          </div>
          <button type="button" className="profile-avatar-btn" onClick={() => fileRef.current?.click()}>
            更换头像
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>

        <div className="profile-field">
          <label>账号</label>
          <input value={user?.account || ''} disabled />
        </div>
        <div className="profile-field">
          <label>昵称</label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="输入昵称" />
        </div>
        <div className="profile-field">
          <label>邮箱</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="输入邮箱地址" />
        </div>
        <div className="profile-field">
          <label>手机号</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="输入手机号码" />
        </div>

        {message && <div className={message === '保存成功' ? 'auth-success' : 'auth-error'}>{message}</div>}

        <button type="submit" className="profile-save-btn" disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}
