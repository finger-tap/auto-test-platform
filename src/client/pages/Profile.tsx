import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, getToken, setUserInfo } from '../utils/api';
import notification from '../utils/notification';
import type { UserInfo } from '../types';
import './Profile.css';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
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
    if (file.size > 2 * 1024 * 1024) {
      notification.error('图片大小不能超过 2MB');
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
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
          updateUser(data.data);
          setAvatarPreview(data.data.avatar || '');
          setAvatarFile(null);
        } else {
          throw new Error(data.message || '头像上传失败');
        }
      }

      const res = await apiFetch<UserInfo>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ nickname: nickname.trim() || null, email: email.trim() || null, phone: phone.trim() || null }),
      });
      if (res.code === 200 && res.data) {
        updateUser(res.data);
        notification.success('保存成功');
      } else {
        throw new Error(res.message || '保存失败');
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const displayName = user?.nickname || user?.account?.slice(0, 8) || 'U';
  const firstChar = displayName.charAt(0).toUpperCase();

  return (
    <div className="profile-layout">
      {/* Page Header */}
      <div className="profile-header">
        <div className="profile-header-avatar" onClick={() => fileRef.current?.click()}>
          {avatarPreview ? (
            <img src={avatarPreview} alt="" />
          ) : (
            <span className="profile-header-avatar-ph">{firstChar}</span>
          )}
          <div className="profile-header-avatar-edit">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </div>
        </div>
        <div className="profile-header-info">
          <h2>{displayName}</h2>
          <p>{user?.account_type === 'email' ? '邮箱账号' : '手机账号'} · {user?.account || ''}</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>

      {/* Content Area */}
      <form className="profile-body" onSubmit={handleSave}>
        {/* Left: Account Info */}
        <div className="profile-card">
          <div className="profile-card-title">账号信息</div>
          <div className="profile-card-content">
            <div className="profile-row">
              <div className="profile-label">账号</div>
              <div className="profile-value profile-value-muted">{user?.account || '-'}</div>
            </div>
            <div className="profile-row">
              <div className="profile-label">账号类型</div>
              <div className="profile-value">{user?.account_type === 'email' ? '邮箱' : '手机'}</div>
            </div>
            <div className="profile-row">
              <div className="profile-label">注册时间</div>
              <div className="profile-value profile-value-muted">-</div>
            </div>
          </div>
        </div>

        {/* Right: Personal Info */}
        <div className="profile-card">
          <div className="profile-card-title">个人信息</div>
          <div className="profile-card-content">
            <div className="profile-row">
              <div className="profile-label">昵称</div>
              <div className="profile-input-wrap">
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="未设置" />
              </div>
            </div>
            <div className="profile-row">
              <div className="profile-label">邮箱</div>
              <div className="profile-input-wrap">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="未绑定邮箱" />
              </div>
            </div>
            <div className="profile-row">
              <div className="profile-label">手机号</div>
              <div className="profile-input-wrap">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="未绑定手机" />
              </div>
            </div>
          </div>

          <div className="profile-card-footer">
            <button type="submit" className="profile-btn-save" disabled={saving}>
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}