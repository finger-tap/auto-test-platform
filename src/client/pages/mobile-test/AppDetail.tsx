// 2026-06-23: 应用详情页 — 版本管理 + 安装到设备

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FormSelect from '../../components/FormSelect';
import DevicePickerModal, { type PickerDevice } from '../../components/DevicePickerModal';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import type { MobileApp, MobileAppVersion } from '../../types';
import './AppDetail.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const PLATFORM_OPTIONS = [
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'harmony', label: 'Harmony' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AppDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // App metadata
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'android' | 'ios' | 'harmony'>('android');
  const [packageName, setPackageName] = useState('');
  const [versions, setVersions] = useState<MobileAppVersion[]>([]);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState('');

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVersion, setUploadVersion] = useState('');
  const [uploadChangelog, setUploadChangelog] = useState('');
  const [uploading, setUploading] = useState(false);

  // Install state
  const [installPickerOpen, setInstallPickerOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [selectedInstallVersion, setSelectedInstallVersion] = useState('');

  // Load
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    apiFetch<MobileApp>(`/mobile-apps/${id}`).then(res => {
      if (res.code === 200 && res.data) {
        const app = res.data;
        setName(app.name);
        setPlatform(app.platform);
        setPackageName(app.package_name || '');
        setLatestVersion(app.latest_version);
        setCreatedAt(app.created_at);
        try { setVersions(JSON.parse(app.versions)); } catch { setVersions([]); }
      }
      setLoading(false);
    });
  }, [id, isNew]);

  // Save metadata
  const handleSave = async () => {
    if (!name.trim()) { notification.error('应用名称不能为空'); return; }
    setSaving(true);
    const body = { name: name.trim(), platform, package_name: packageName || undefined };
    const res = isNew
      ? await apiFetch('/mobile-apps', { method: 'POST', body: JSON.stringify(body) })
      : await apiFetch(`/mobile-apps/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    setSaving(false);
    if (res.code === 200) {
      if (isNew && res.data) {
        navigate(`/mobile-test/apps/${(res.data as any).id}`, { replace: true });
      }
      notification.success(isNew ? '创建成功' : '保存成功');
    } else {
      notification.error(res.message || '保存失败');
    }
  };

  // Upload version
  const handleUpload = async () => {
    if (!uploadFile) { notification.error('请选择文件'); return; }
    if (!uploadVersion.trim()) { notification.error('请输入版本号'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('version', uploadVersion.trim());
      formData.append('changelog', uploadChangelog.trim());

      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/mobile-apps/${id}/versions`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.code === 200) {
        notification.success('上传成功');
        setUploadFile(null); setUploadVersion(''); setUploadChangelog('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        // Reload
        const refresh = await apiFetch<MobileApp>(`/mobile-apps/${id}`);
        if (refresh.code === 200 && refresh.data) {
          try { setVersions(JSON.parse(refresh.data.versions)); } catch {}
          setLatestVersion(refresh.data.latest_version);
        }
      } else {
        notification.error(data.message || '上传失败');
      }
    } catch (err) {
      notification.error('上传失败');
    } finally {
      setUploading(false);
    }
  };

  // Delete version
  const handleDeleteVersion = async (version: string) => {
    const ok = await notification.confirm(`确认删除版本 v${version}？安装包文件将被清除。`);
    if (!ok) return;
    const res = await apiFetch(`/mobile-apps/${id}/versions/${encodeURIComponent(version)}`, { method: 'DELETE' });
    if (res.code === 200) {
      notification.success('删除成功');
      setVersions(prev => prev.filter(v => v.version !== version));
    } else {
      notification.error(res.message || '删除失败');
    }
  };

  // Install to device
  const handleInstallToDevice = async (device: PickerDevice) => {
    setInstallPickerOpen(false);
    const version = selectedInstallVersion || latestVersion;
    if (!version) { notification.error('没有可安装的版本'); return; }
    setInstalling(true);
    try {
      const res = await apiFetch(`/mobile-apps/${id}/install`, {
        method: 'POST',
        body: JSON.stringify({ deviceId: device.id, version }),
      });
      if (res.code === 200) {
        notification.success(`已安装到 ${device.name}`);
      } else {
        notification.error(res.message || '安装失败');
      }
    } catch {
      notification.error('安装失败');
    } finally {
      setInstalling(false);
    }
  };

  if (loading) return <div className="ad-page"><div className="ad-loading">加载中...</div></div>;

  return (
    <div className="ad-page">
      {/* Header */}
      <div className="ad-header">
        <div className="ad-header-left">
          <button className="ad-back" onClick={() => navigate('/mobile-test/apps')}>← 返回</button>
          <input
            className="ad-title-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="应用名称"
          />
          {!isNew && createdAt && (
            <span className="meta-time">创建于 {createdAt.slice(0, 16)}</span>
          )}
        </div>
        <div className="ad-header-actions">
          <button className="sset-btn sset-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="ad-content">
        {/* Metadata section */}
        <div className="ad-section">
          <div className="ad-section-head">基本信息</div>
          <div className="app-detail-grid">
            <label>
              <span>平台</span>
              <FormSelect value={platform} options={PLATFORM_OPTIONS} onChange={v => setPlatform(v as any)} />
            </label>
            <label>
              <span>包名</span>
              <input value={packageName} onChange={e => setPackageName(e.target.value)} placeholder="如：com.tencent.mm" />
            </label>
          </div>
        </div>

        {/* Versions section */}
        {!isNew && (
          <div className="ad-section">
            <div className="ad-section-head">
              版本管理
              {versions.length > 0 && (
                <button
                  className="sset-btn sset-btn-primary app-install-btn"
                  onClick={() => setInstallPickerOpen(true)}
                  disabled={installing}
                >
                  {installing ? '安装中...' : '安装到设备'}
                </button>
              )}
            </div>

            {/* Upload form */}
            <div className="app-upload-form">
              <input
                ref={fileInputRef}
                type="file"
                accept=".apk,.ipa,.hap"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
              />
              <input
                value={uploadVersion}
                onChange={e => setUploadVersion(e.target.value)}
                placeholder="版本号 (如 1.0.0)"
                className="app-upload-version"
              />
              <input
                value={uploadChangelog}
                onChange={e => setUploadChangelog(e.target.value)}
                placeholder="更新说明（可选）"
                className="app-upload-changelog"
              />
              <button className="sset-btn sset-btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? '上传中...' : '上传版本'}
              </button>
            </div>

            {/* Version list */}
            {versions.length === 0 ? (
              <div className="app-no-versions">暂无版本，请上传安装包</div>
            ) : (
              <table className="alist-table app-version-table">
                <thead>
                  <tr>
                    <th>版本号</th>
                    <th>文件大小</th>
                    <th>上传时间</th>
                    <th>更新说明</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(v => (
                    <tr key={v.version} className={v.version === latestVersion ? 'app-version-latest' : ''}>
                      <td>
                        <span className="app-version-tag">{v.version}</span>
                        {v.version === latestVersion && <span className="app-latest-badge">最新</span>}
                      </td>
                      <td>{formatFileSize(v.file_size)}</td>
                      <td className="alist-cell-time">{v.uploaded_at?.slice(0, 16)}</td>
                      <td className="app-changelog">{v.changelog || '-'}</td>
                      <td>
                        <button className="alist-action-btn alist-action-btn--danger" onClick={() => handleDeleteVersion(v.version)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Install device picker */}
      <DevicePickerModal
        open={installPickerOpen}
        testType="mobile"
        onClose={() => setInstallPickerOpen(false)}
        onLocalExecute={() => {
          setInstallPickerOpen(false);
          // Local install: no deviceId
          const doInstall = async () => {
            const version = selectedInstallVersion || latestVersion;
            if (!version) { notification.error('没有可安装的版本'); return; }
            setInstalling(true);
            try {
              const res = await apiFetch(`/mobile-apps/${id}/install`, {
                method: 'POST',
                body: JSON.stringify({ version }),
              });
              if (res.code === 200) notification.success('本地安装成功');
              else notification.error(res.message || '安装失败');
            } catch { notification.error('安装失败'); }
            finally { setInstalling(false); }
          };
          doInstall();
        }}
        onSelect={handleInstallToDevice}
      />
    </div>
  );
}
