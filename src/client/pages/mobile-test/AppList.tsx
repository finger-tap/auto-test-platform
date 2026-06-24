// 2026-06-23: 应用管理列表 — APK/IPA/HAP 包管理

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import FormSelect from '../../components/FormSelect';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import type { MobileApp, MobileAppVersion } from '../../types';
import '../api-test/ApiList.css';
import './AppList.css';

const PLATFORM_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'harmony', label: 'Harmony' },
];

const PLATFORM_LABELS: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  harmony: 'Harmony',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AppList() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<MobileApp[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [fName, setFName] = useState('');
  const [fPlatform, setFPlatform] = useState('');
  const [fPackageName, setFPackageName] = useState('');
  const [appliedName, setAppliedName] = useState('');
  const [appliedPlatform, setAppliedPlatform] = useState('');
  const [appliedPackageName, setAppliedPackageName] = useState('');

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlatform, setNewPlatform] = useState<'android' | 'ios' | 'harmony'>('android');
  const [newPackageName, setNewPackageName] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await apiFetch<MobileApp[]>('/mobile-apps');
    if (res.code === 200 && res.data) setApps(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return apps.filter(app => {
      if (appliedName && !app.name.toLowerCase().includes(appliedName.toLowerCase())) return false;
      if (appliedPlatform && app.platform !== appliedPlatform) return false;
      if (appliedPackageName && !(app.package_name || '').toLowerCase().includes(appliedPackageName.toLowerCase())) return false;
      return true;
    });
  }, [apps, appliedName, appliedPlatform, appliedPackageName]);

  const handleSearch = () => {
    setAppliedName(fName);
    setAppliedPlatform(fPlatform);
    setAppliedPackageName(fPackageName);
  };

  const handleReset = () => {
    setFName(''); setFPlatform(''); setFPackageName('');
    setAppliedName(''); setAppliedPlatform(''); setAppliedPackageName('');
  };

  const handleDelete = async (app: MobileApp, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await notification.confirm(`确认删除应用「${app.name}」？所有版本文件将被清除。`);
    if (!ok) return;
    const res = await apiFetch(`/mobile-apps/${app.id}`, { method: 'DELETE' });
    if (res.code === 200) {
      notification.success('删除成功');
      load();
    } else {
      notification.error(res.message || '删除失败');
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) { notification.error('请输入应用名称'); return; }
    const res = await apiFetch('/mobile-apps', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim(), platform: newPlatform, package_name: newPackageName || undefined }),
    });
    if (res.code === 200 && res.data) {
      setShowCreate(false);
      setNewName(''); setNewPlatform('android'); setNewPackageName('');
      navigate(`/mobile-test/apps/${(res.data as any).id}`);
    } else {
      notification.error(res.message || '创建失败');
    }
  };

  const getVersionCount = (app: MobileApp): number => {
    try { return (JSON.parse(app.versions) as MobileAppVersion[]).length; }
    catch { return 0; }
  };

  return (
    <div className="alist page-enter">
      <CollapsibleFilter
        primary={
          <>
            <FilterItem label="应用名称">
              <input value={fName} onChange={e => setFName(e.target.value)} placeholder="搜索名称" />
            </FilterItem>
            <FilterItem label="平台">
              <FormSelect value={fPlatform} options={PLATFORM_OPTIONS} onChange={setFPlatform} />
            </FilterItem>
          </>
        }
        advanced={
          <FilterItem label="包名">
            <input value={fPackageName} onChange={e => setFPackageName(e.target.value)} placeholder="搜索包名" />
          </FilterItem>
        }
        actions={
          <>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={handleSearch}>查询</button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>新建应用</button>
          </>
        }
      />

      <div className="alist-table-wrap">
        <table className="alist-table">
          <thead>
            <tr>
              <th>应用名称</th>
              <th>平台</th>
              <th>包名</th>
              <th>最新版本</th>
              <th>版本数</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="alist-empty">加载中...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="alist-empty">暂无应用</td></tr>
            ) : filtered.map(app => (
              <tr key={app.id} className="alist-row" onClick={() => navigate(`/mobile-test/apps/${app.id}`)}>
                <td className="alist-cell-name">{app.name}</td>
                <td><span className={`app-platform-badge app-platform-${app.platform}`}>{PLATFORM_LABELS[app.platform] || app.platform}</span></td>
                <td className="alist-cell-mono">{app.package_name || '-'}</td>
                <td>{app.latest_version || '-'}</td>
                <td>{getVersionCount(app)}</td>
                <td className="alist-cell-time">{app.created_at?.slice(0, 16)}</td>
                <td>
                  <button className="alist-action-btn alist-action-btn--danger" onClick={e => handleDelete(app, e)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>新建应用</h3>
            <label>
              <span>应用名称</span>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="如：微信" autoFocus />
            </label>
            <label>
              <span>平台</span>
              <FormSelect
                value={newPlatform}
                options={[
                  { value: 'android', label: 'Android' },
                  { value: 'ios', label: 'iOS' },
                  { value: 'harmony', label: 'Harmony' },
                ]}
                onChange={v => setNewPlatform(v as 'android' | 'ios' | 'harmony')}
              />
            </label>
            <label>
              <span>包名（可选）</span>
              <input value={newPackageName} onChange={e => setNewPackageName(e.target.value)} placeholder="如：com.tencent.mm" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-default" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
