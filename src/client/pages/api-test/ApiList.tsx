import { useState, useEffect, useRef, type FormEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { ApiItem } from '../../types';
import './ApiList.css';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

export default function ApiList() {
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Filter state
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fTags, setFTags] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');

  // Floating action buttons
  const [floatBtn, setFloatBtn] = useState<{ id: number; x: number; y: number } | null>(null);

  const navigate = useNavigate();

  const fetchApis = async () => {
    try {
      const res = await apiFetch<ApiItem[]>('/apis');
      if (res.code === 200 && res.data) setApis(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchApis(); }, []);

  // Close floating buttons on outside click
  useEffect(() => {
    const handler = () => setFloatBtn(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleRowClick = (e: MouseEvent, id: number) => {
    e.stopPropagation();
    setFloatBtn({ id, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此接口？')) return;
    await apiFetch(`/apis/${id}`, { method: 'DELETE' });
    setFloatBtn(null);
    fetchApis();
  };

  const filtered = apis.filter((api) => {
    if (fStatus && api.status !== fStatus) return false;
    if (fName) {
      const s = fName.toLowerCase();
      if (!api.name.toLowerCase().includes(s) && !api.url.toLowerCase().includes(s)) return false;
    }
    if (fDesc && !(api.description || '').toLowerCase().includes(fDesc.toLowerCase())) return false;
    if (fTags && !(api.tags || '').toLowerCase().includes(fTags.toLowerCase())) return false;
    if (fDateFrom && api.created_at < fDateFrom) return false;
    if (fDateTo && api.created_at > fDateTo + 'T23:59:59') return false;
    return true;
  });

  const statusLabel = (s: string) => {
    if (s === 'active') return '启用';
    if (s === 'disabled') return '禁用';
    if (s === 'draft') return '草稿';
    return s;
  };

  return (
    <div className="alist">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>接口名称</label>
            <input placeholder="搜索名称或URL" value={fName} onChange={(e) => setFName(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>描述</label>
            <input placeholder="搜索描述" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <input placeholder="搜索标签" value={fTags} onChange={(e) => setFTags(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>创建时间起</label>
            <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>创建时间止</label>
            <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
          </div>
          <div className="alist-filter-actions">
            <button className="alist-btn-query">查询</button>
            <button className="alist-btn-add" onClick={() => setShowCreate(true)}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th>接口名称</th>
                <th>方法</th>
                <th>URL</th>
                <th>标签</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((api) => (
                <tr key={api.id} onClick={(e) => handleRowClick(e, api.id)} className={floatBtn?.id === api.id ? 'active-row' : ''}>
                  <td>{api.name}</td>
                  <td><span className={`method-badge method-${api.method}`}>{api.method}</span></td>
                  <td className="td-url">{api.url}</td>
                  <td>
                    {api.tags ? api.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${api.status}`}>{statusLabel(api.status)}</span></td>
                  <td>{api.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>{api.updated_at.replace('T', ' ').slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Floating Action Buttons */}
      {floatBtn && (
        <div
          className="alist-float"
          style={{ left: floatBtn.x, top: floatBtn.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="alist-float-btn alist-float-view" onClick={() => { setFloatBtn(null); navigate(`/api-test/${floatBtn.id}`); }}>
            查看
          </button>
          <button className="alist-float-btn alist-float-exec" onClick={() => { setFloatBtn(null); navigate(`/api-test/${floatBtn.id}?exec=1`); }}>
            执行
          </button>
          <button className="alist-float-btn alist-float-del" onClick={() => handleDelete(floatBtn.id)}>
            删除
          </button>
        </div>
      )}

      {showCreate && <CreateApiModal onClose={() => setShowCreate(false)} onCreated={fetchApis} />}
    </div>
  );
}

function CreateApiModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [protocol, setProtocol] = useState('https');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{ id: number }>('/apis', {
        method: 'POST',
        body: JSON.stringify({ name, method, url, protocol, headers, body, description, tags, status }),
      });
      if (res.code !== 201) throw new Error(res.message);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-modal-overlay" onClick={onClose}>
      <div className="form-modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建接口</h3>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-item">
            <label>接口名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例如：获取用户列表" />
          </div>
          <div className="form-row">
            <div className="form-item">
              <label>请求方法 *</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-item">
              <label>协议</label>
              <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
                <option value="ws">WebSocket</option>
              </select>
            </div>
          </div>
          <div className="form-item">
            <label>请求地址 *</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="例如：api.example.com/users" />
          </div>
          <div className="form-row">
            <div className="form-item">
              <label>标签</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
            </div>
            <div className="form-item">
              <label>状态</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
                <option value="draft">草稿</option>
              </select>
            </div>
          </div>
          <div className="form-item">
            <label>请求头 (JSON)</label>
            <textarea rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"Content-Type": "application/json"}' />
          </div>
          <div className="form-item">
            <label>请求体</label>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder='{"key": "value"}' />
          </div>
          <div className="form-item">
            <label>描述</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="接口描述（可选）" />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>取消</button>
            <button type="submit" className="btn-submit" disabled={submitting}>{submitting ? '创建中...' : '创建'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
