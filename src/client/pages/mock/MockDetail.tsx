import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import MessageModal from '../../components/MessageModal';

interface MockEndpoint {
  id: number;
  name: string;
  method: string;
  path_pattern: string;
  description: string | null;
  response_status: number;
  response_headers: string;
  response_body: string;
  response_delay_ms: number;
  conditions: string;
  match_mode: string;
  enabled: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*'];
const MATCH_MODES = [
  { value: 'exact', label: '精确匹配' },
  { value: 'contains', label: '包含' },
  { value: 'wildcard', label: '通配符（/api/users/:id）' },
  { value: 'regex', label: '正则表达式' },
];

export default function MockDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [msgOpen, setMsgOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [method, setMethod] = useState('GET');
  const [pathPattern, setPathPattern] = useState('');
  const [description, setDescription] = useState('');
  const [responseStatus, setResponseStatus] = useState(200);
  const [responseHeaders, setResponseHeaders] = useState('{"Content-Type":"application/json"}');
  const [responseBody, setResponseBody] = useState('{}');
  const [responseDelay, setResponseDelay] = useState(0);
  const [matchMode, setMatchMode] = useState('exact');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!isNew && id) {
      apiFetch<MockEndpoint>(`/mocks/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          const d = res.data;
          setName(d.name);
          setMethod(d.method);
          setPathPattern(d.path_pattern);
          setDescription(d.description || '');
          setResponseStatus(d.response_status);
          setResponseHeaders(d.response_headers);
          setResponseBody(d.response_body);
          setResponseDelay(d.response_delay_ms);
          setMatchMode(d.match_mode);
          setEnabled(!!d.enabled);
        }
      }).finally(() => setLoading(false));
    }
  }, [id]);

  async function doSave() {
    if (!name.trim() || !pathPattern.trim()) {
      setMsg('名称和路径不能为空'); setMsgType('error'); setMsgOpen(true); return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        method,
        path_pattern: pathPattern.trim(),
        description,
        response_status: responseStatus,
        response_headers: responseHeaders,
        response_body: responseBody,
        response_delay_ms: responseDelay,
        match_mode: matchMode,
        enabled,
      };

      if (isNew) {
        const res = await apiFetch<{ id: number }>('/mocks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.code === 201 && res.data) {
          setMsgType('success'); setMsg('创建成功'); setMsgOpen(true);
          setTimeout(() => navigate(`/mock/${res.data!.id}`), 1200);
        } else {
          setMsgType('error'); setMsg(res.message || '创建失败'); setMsgOpen(true);
        }
      } else {
        const res = await apiFetch(`/mocks/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (res.code === 200) {
          setMsgType('success'); setMsg('保存成功'); setMsgOpen(true);
        } else {
          setMsgType('error'); setMsg(res.message || '保存失败'); setMsgOpen(true);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function formatJson(val: string): string {
    try { return JSON.stringify(JSON.parse(val), null, 2); } catch { return val; }
  }

  if (loading) return <div style={{ padding: 40, color: '#999' }}>加载中...</div>;

  return (
    <div style={{ padding: 24 }}>
      <div className="mock-detail-head">
        <button className="mock-back-btn" onClick={() => navigate('/api-test/mock')}>← 返回列表</button>
        <h2>{isNew ? '新建 Mock 端点' : '编辑 Mock 端点'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            启用
          </label>
          <button className="mock-save-btn" onClick={doSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="mock-card">
        <h3>基本信息</h3>
        <div className="mock-form-row">
          <div className="mock-form-field">
            <label>名称 <span style={{ color: '#ff4d4f' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：获取用户列表" />
          </div>
          <div className="mock-form-field">
            <label>描述</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="可选说明" />
          </div>
        </div>
        <div className="mock-form-row">
          <div className="mock-form-field" style={{ width: 120 }}>
            <label>方法</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="mock-form-field" style={{ flex: 1 }}>
            <label>路径 <span style={{ color: '#ff4d4f' }}>*</span></label>
            <input value={pathPattern} onChange={e => setPathPattern(e.target.value)} placeholder="/api/users/:id" style={{ fontFamily: 'monospace' }} />
          </div>
          <div className="mock-form-field" style={{ width: 140 }}>
            <label>匹配模式</label>
            <select value={matchMode} onChange={e => setMatchMode(e.target.value)}>
              {MATCH_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Response Config */}
      <div className="mock-card">
        <h3>响应配置</h3>
        <div className="mock-form-row">
          <div className="mock-form-field" style={{ width: 120 }}>
            <label>状态码</label>
            <input type="number" value={responseStatus} onChange={e => setResponseStatus(Number(e.target.value))} />
          </div>
          <div className="mock-form-field" style={{ width: 160 }}>
            <label>延迟 (ms)</label>
            <input type="number" value={responseDelay} onChange={e => setResponseDelay(Number(e.target.value))} placeholder="0" />
          </div>
        </div>
        <div className="mock-form-field">
          <label>响应头 (JSON)</label>
          <textarea
            className="mock-textarea"
            rows={3}
            value={formatJson(responseHeaders)}
            onChange={e => setResponseHeaders(e.target.value)}
            placeholder='{"Content-Type":"application/json"}'
          />
        </div>
        <div className="mock-form-field">
          <label>响应体 (JSON)</label>
          <textarea
            className="mock-textarea"
            rows={10}
            value={formatJson(responseBody)}
            onChange={e => setResponseBody(e.target.value)}
            placeholder='{"code":0,"data":{"name":"test"}}'
          />
        </div>
      </div>

      {/* Hit Stats */}
      {!isNew && (
        <div className="mock-card">
          <h3>命中统计</h3>
          <div className="mock-hit-stats">
            <div className="mock-stat">
              <span className="mock-stat-label">累计命中</span>
              <span className="mock-stat-value">—</span>
            </div>
            <div className="mock-stat">
              <span className="mock-stat-label">最近命中</span>
              <span className="mock-stat-value">—</span>
            </div>
          </div>
        </div>
      )}

      <MessageModal open={msgOpen} message={msg} type={msgType} onClose={() => setMsgOpen(false)} />
    </div>
  );
}