import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { ApiItem } from '../../types';
import './ApiList.css';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

export default function ApiList() {
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
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

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此接口？')) return;
    await apiFetch(`/apis/${id}`, { method: 'DELETE' });
    fetchApis();
  };

  const handleExecute = async (id: number) => {
    navigate(`/api-test/${id}`);
  };

  const filtered = apis.filter((api) => {
    if (methodFilter && api.method !== methodFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return api.name.toLowerCase().includes(s) || api.url.toLowerCase().includes(s);
    }
    return true;
  });

  return (
    <div>
      <div className="api-list-header">
        <h2>接口测试</h2>
        <button className="form-modal btn-submit" onClick={() => setShowCreate(true)}>新建接口</button>
      </div>

      <div className="api-list-toolbar">
        <input placeholder="搜索接口名称或 URL..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
          <option value="">全部方法</option>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {loading ? <div className="api-empty">加载中...</div> : (
        filtered.length === 0 ? (
          <div className="api-empty">暂无接口，点击"新建接口"开始</div>
        ) : (
          <table className="api-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>方法</th>
                <th>URL</th>
                <th>协议</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((api) => (
                <tr key={api.id}>
                  <td>{api.name}</td>
                  <td><span className={`method-badge method-${api.method}`}>{api.method}</span></td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{api.url}</td>
                  <td>{api.protocol}</td>
                  <td>{api.updated_at.replace('T', ' ').slice(0, 19)}</td>
                  <td>
                    <div className="api-actions">
                      <button className="act-edit" onClick={() => navigate(`/api-test/${api.id}`)}>编辑</button>
                      <button className="act-exec" onClick={() => handleExecute(api.id)}>执行</button>
                      <button className="act-del" onClick={() => handleDelete(api.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{ id: number }>('/apis', {
        method: 'POST',
        body: JSON.stringify({ name, method, url, protocol, headers, body, description }),
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
