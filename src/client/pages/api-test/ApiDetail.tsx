import { useState, useEffect, Fragment, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { ApiItem, ApiLog } from '../../types';
import './ApiDetail.css';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

export default function ApiDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [api, setApi] = useState<ApiItem | null>(null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [editing, setEditing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ApiLog | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Edit form state
  const [form, setForm] = useState({
    name: '', method: 'GET', url: '', protocol: 'https',
    headers: '', body: '', description: '', tags: '', status: 'active',
  });

  useEffect(() => {
    if (!id) return;
    apiFetch<ApiItem>(`/apis/${id}`).then((res) => {
      if (res.code === 200 && res.data) {
        setApi(res.data);
        setForm({
          name: res.data.name,
          method: res.data.method,
          url: res.data.url,
          protocol: res.data.protocol,
          headers: res.data.headers || '',
          body: res.data.body || '',
          description: res.data.description || '',
          tags: res.data.tags || '',
          status: res.data.status || 'active',
        });
      }
    });
    apiFetch<ApiLog[]>(`/apis/${id}/logs`).then((res) => {
      if (res.code === 200 && res.data) setLogs(res.data);
    });
  }, [id]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiFetch(`/apis/${id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      if (res.code !== 200) throw new Error(res.message);
      setEditing(false);
      setApi({ ...api!, ...form, updated_at: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setLastResult(null);
    try {
      const res = await apiFetch<ApiLog>(`/apis/${id}/execute`, { method: 'POST' });
      if (res.code === 200 && res.data) {
        setLastResult(res.data);
        // Refresh logs
        const logsRes = await apiFetch<ApiLog[]>(`/apis/${id}/logs`);
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setExecuting(false);
    }
  };

  if (!api) return <div className="api-empty">加载中...</div>;

  const statusClass = (code: number | null) => {
    if (!code) return 'status-0';
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400 && code < 500) return 'status-4xx';
    return 'status-5xx';
  };

  const tryFormatJson = (text: string | null) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  return (
    <div className="api-detail">
      <button className="api-detail-back" onClick={() => navigate('/api-test')}>
        ← 返回列表
      </button>

      {/* API Config Card */}
      <div className="api-detail-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, border: 'none', paddingBottom: 0 }}>接口配置</h3>
          {!editing && <button className="form-modal btn-submit" style={{ padding: '6px 16px', fontSize: '13px' }} onClick={() => setEditing(true)}>编辑</button>}
        </div>

        {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}

        {editing ? (
          <form onSubmit={handleSave} style={{ marginTop: 16 }}>
            <div className="api-detail-row">
              <div className="field">
                <label>接口名称</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>请求方法</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label>协议</label>
                <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
                  <option value="https">HTTPS</option>
                  <option value="http">HTTP</option>
                  <option value="ws">WebSocket</option>
                </select>
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>请求地址</label>
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>标签</label>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="多个标签用逗号分隔" />
              </div>
              <div className="field">
                <label>状态</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">启用</option>
                  <option value="disabled">禁用</option>
                  <option value="draft">草稿</option>
                </select>
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>请求头 (JSON)</label>
                <textarea rows={3} value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} />
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>请求体</label>
                <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>描述</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="api-detail-actions">
              <button type="submit" className="form-modal btn-submit" style={{ fontSize: '13px' }}>保存</button>
              <button type="button" className="form-modal btn-cancel" onClick={() => setEditing(false)}>取消</button>
            </div>
          </form>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="api-detail-row">
              <div className="field"><label>接口名称</label><div className="value">{api.name}</div></div>
              <div className="field"><label>方法</label><div className="value"><span className={`method-badge method-${api.method}`}>{api.method}</span></div></div>
              <div className="field"><label>协议</label><div className="value">{api.protocol}</div></div>
            </div>
            <div className="api-detail-row">
              <div className="field"><label>请求地址</label><div className="value" style={{ fontFamily: 'monospace' }}>{api.url}</div></div>
            </div>
            <div className="api-detail-row">
              <div className="field"><label>标签</label><div className="value">{api.tags ? api.tags.split(',').filter(Boolean).map((t) => (
                <span key={t} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, background: '#f0f5ff', color: 'var(--primary)', marginRight: 4 }}>{t.trim()}</span>
              )) : '-'}</div></div>
              <div className="field"><label>状态</label><div className="value"><span className={`status-text status-${api.status}`}>{api.status === 'active' ? '启用' : api.status === 'disabled' ? '禁用' : '草稿'}</span></div></div>
            </div>
            {api.description && (
              <div className="api-detail-row">
                <div className="field"><label>描述</label><div className="value">{api.description}</div></div>
              </div>
            )}
            {api.headers && (
              <div className="api-detail-row">
                <div className="field"><label>请求头</label><pre>{tryFormatJson(api.headers)}</pre></div>
              </div>
            )}
            {api.body && (
              <div className="api-detail-row">
                <div className="field"><label>请求体</label><pre>{tryFormatJson(api.body)}</pre></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Execute Card */}
      <div className="api-detail-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, border: 'none', paddingBottom: 0 }}>执行</h3>
          <button className="form-modal btn-submit" style={{ padding: '8px 24px' }} onClick={handleExecute} disabled={executing}>
            {executing ? '执行中...' : '执行'}
          </button>
        </div>

        {lastResult && (
          <div className="exec-result">
            <div className="exec-result-header">
              <span className={`status-badge ${statusClass(lastResult.status_code)}`}>
                {lastResult.status_code || 'Error'}
              </span>
              {lastResult.duration_ms != null && (
                <span className="duration-badge">{lastResult.duration_ms} ms</span>
              )}
            </div>
            {lastResult.response_body && (
              <pre>{tryFormatJson(lastResult.response_body)}</pre>
            )}
          </div>
        )}
      </div>

      {/* Logs Card */}
      <div className="api-detail-card">
        <h3>执行日志</h3>
        {logs.length === 0 ? (
          <div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>状态码</th>
                <th>耗时</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr>
                    <td>{log.executed_at.replace('T', ' ').slice(0, 19)}</td>
                    <td><span className={`status-badge ${statusClass(log.status_code)}`}>{log.status_code || 'Error'}</span></td>
                    <td>{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</td>
                    <td>
                      <button className="log-view-btn" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                        {expandedLog === log.id ? '收起' : '查看'}
                      </button>
                    </td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr>
                      <td colSpan={4} className="log-expanded">
                        {log.response_body && <pre>{tryFormatJson(log.response_body)}</pre>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
