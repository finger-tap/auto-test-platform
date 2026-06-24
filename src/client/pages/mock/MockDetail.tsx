import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ThemedCodeMirror from '../../components/ThemedCodeMirror';
import FormSelect from '../../components/FormSelect';
import { json } from '@codemirror/lang-json';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import notification from '../../utils/notification';
import './MockDetail.css';

interface MockCondition {
  id: string;
  source: 'query' | 'header' | 'body';
  param: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'gt' | 'lt';
  value: string;
}

interface MockDetailData {
  id: number;
  name: string;
  method: string;
  path_pattern: string;
  description: string | null;
  tags: string;
  status: string;
  match_mode: string;
  response_status: number;
  response_delay_ms: number;
  response_headers: string;
  response_body: string;
  conditions: string;
  enabled: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

const TABS = [
  { key: 'detail', label: '基本信息' },
  { key: 'match', label: '匹配配置' },
  { key: 'response', label: '响应配置' },
];

const METHODS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'PATCH', label: 'PATCH' },
  { value: '*', label: '任意方法' },
];

const MATCH_MODES = [
  { value: 'exact', label: '精确匹配' },
  { value: 'contains', label: '包含匹配' },
  { value: 'wildcard', label: '通配符匹配' },
  { value: 'regex', label: '正则匹配' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
];

const COND_SOURCES = [
  { value: 'query', label: 'Query 参数' },
  { value: 'header', label: '请求头' },
  { value: 'body', label: 'Body 字段' },
];

const COND_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'exists', label: '存在' },
  { value: 'not_exists', label: '不存在' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a', POST: '#1677ff', PUT: '#faad14', DELETE: '#ff4d4f', PATCH: '#722ed1', '*': '#999',
};

export default function MockDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  // Mock 服务只属于接口测试(API),后端表为 mocks-api。
  const mocksPath = '/mocks-api';

  const [loading, setLoading] = useState(!isNew);
  const [conditions, setConditions] = useState<MockCondition[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('detail');
  const [dirty, setDirty] = useState(false);

  // 基本信息
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [method, setMethod] = useState('GET');
  const [pathPattern, setPathPattern] = useState('');
  const [status, setStatus] = useState('active');
  const [matchMode, setMatchMode] = useState('exact');

  // 响应配置
  const [responseStatus, setResponseStatus] = useState(200);
  const [responseDelay, setResponseDelay] = useState(0);
  const [responseHeaders, setResponseHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [responseBody, setResponseBody] = useState('{\n  "code": 0,\n  "data": {}\n}');

  // 匹配条件（已在上面声明）

  // 命中统计（只读）
  const [hitCount, setHitCount] = useState(0);
  const [lastHitAt, setLastHitAt] = useState<string | null>(null);

  const dirtyRef = (val: boolean) => setDirty(val);

  // 加载详情
  useEffect(() => {
    if (!isNew && id) {
      apiFetch<MockDetailData>(`${mocksPath}/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          const d = res.data;
          setName(d.name);
          setDescription(d.description || '');
          setTags(d.tags || '');
          setMethod(d.method);
          setPathPattern(d.path_pattern);
          setStatus(d.status || 'active');
          setMatchMode(d.match_mode || 'exact');
          setResponseStatus(d.response_status);
          setResponseDelay(d.response_delay_ms || 0);
          try { setResponseHeaders(JSON.stringify(JSON.parse(d.response_headers || '{}'), null, 2)); } catch { setResponseHeaders(d.response_headers); }
          try { setResponseBody(JSON.stringify(JSON.parse(d.response_body || '{}'), null, 2)); } catch { setResponseBody(d.response_body); }
          setHitCount(d.hit_count || 0);
          setLastHitAt(d.last_hit_at);
          try {
            const parsed = JSON.parse(d.conditions || '[]') as Omit<MockCondition, 'id'>[];
            setConditions(parsed.map((c, idx) => ({ ...c, id: `cond-${idx}-${Date.now()}` })));
          } catch { setConditions([]); }
        }
      }).finally(() => setLoading(false));
    }
  }, [id]);

  // 条件操作
  function addCondition() {
    setConditions(prev => [...prev, {
      id: `cond-${Date.now()}`,
      source: 'query',
      param: '',
      operator: 'equals',
      value: '',
    }]);
    dirtyRef(true);
  }

  function removeCondition(id: string) {
    setConditions(prev => prev.filter(c => c.id !== id));
    dirtyRef(true);
  }

  function updateCondition(id: string, field: keyof MockCondition, value: string) {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    dirtyRef(true);
  }

  async function doSave() {
    if (!name.trim()) { notification.error('名称不能为空'); return; }
    if (!pathPattern.trim()) { notification.error('请求路径不能为空'); return; }

    // 过滤空条件
    const validConditions = conditions
      .filter(c => c.param.trim())
      .map(({ id: _id, ...c }) => c);

    const payload = {
      name: name.trim(),
      description,
      tags,
      method,
      path_pattern: pathPattern.trim(),
      status,
      match_mode: matchMode,
      response_status: responseStatus,
      response_delay_ms: responseDelay,
      response_headers: responseHeaders,
      response_body: responseBody,
      conditions: JSON.stringify(validConditions),
      enabled: status === 'active' ? 1 : 0,
    };

    setSaving(true);
    try {
      if (isNew) {
        const res = await apiFetch<{ id: number }>(mocksPath, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.code === 201 && res.data) {
          setDirty(false);
          setTimeout(() => navigate(`/api-test/mock/${res.data!.id}`), 300);
          return;
        }
        notification.error(res.message || '创建失败');
      } else {
        const res = await apiFetch(`${mocksPath}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        if (res.code === 200) {
          setDirty(false);
          notification.success('保存成功');
          return;
        }
        notification.error(res.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() { navigate('/api-test/mock'); }

  function formatJsonStr(val: string): string {
    try { return JSON.stringify(JSON.parse(val), null, 2); } catch { return val; }
  }

  if (loading) return <div className="api-empty">加载中...</div>;

  // ─── Tab: 基本信息 ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="api-detail-row">
          <div className="field"><label>名称</label>
            <InlineText value={name} onChange={v => { setName(v); dirtyRef(true); }} placeholder="点击输入名称" />
          </div>
          <div className="field"><label>状态</label>
            <InlineSelect
              value={status}
              options={STATUS_OPTIONS}
              onChange={v => { setStatus(v); dirtyRef(true); }}
              renderDisplay={(v, label) => <span className={`status-text status-${v}`}>{label}</span>}
            />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>描述</label>
            <InlineText value={description} onChange={v => { setDescription(v); dirtyRef(true); }} placeholder="点击输入描述" multiline />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>标签</label>
            <TagInput value={tags} onChange={v => { setTags(v); dirtyRef(true); }} placeholder="点击选择标签" />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>请求方法</label>
            <InlineSelect value={method} options={METHODS} onChange={v => { setMethod(v); dirtyRef(true); }}
              renderDisplay={(v) => (
                <span className="method-badge" style={{ background: METHOD_COLORS[v] || '#999', color: '#fff' }}>{v}</span>
              )}
            />
          </div>
          <div className="field field-url"><label>请求路径</label>
            <InlineText value={pathPattern} onChange={v => { setPathPattern(v); dirtyRef(true); }} placeholder="点击输入路径，如 /api/users/:id" monospace />
          </div>
        </div>
        {/* 命中统计 */}
        {!isNew && (
          <div className="api-detail-row">
            <div className="field"><label>累计命中</label><span className="field-value">{hitCount}</span></div>
            <div className="field"><label>最近命中</label><span className="field-value">{formatDateTime(lastHitAt) || '从未'}</span></div>
          </div>
        )}
        {!isNew && (
          <div className="api-detail-row">
            <div className="field"><label>创建时间</label><span className="field-value">-</span></div>
            <div className="field"><label>更新时间</label><span className="field-value">-</span></div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: 匹配配置 ───
  const renderMatchTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>路径匹配</label>
          <InlineSelect
            value={matchMode}
            options={MATCH_MODES}
            onChange={v => { setMatchMode(v); dirtyRef(true); }}
            renderDisplay={(v, label) => <span className="match-mode-display">{label}</span>}
          />
        </div>
        <div className="match-mode-hint">
          {matchMode === 'exact' && '精确匹配：请求路径需与 Mock 路径完全一致。例如 `/api/users` 仅匹配 `/api/users`。'}
          {matchMode === 'contains' && '包含匹配：请求路径包含 Mock 路径即可匹配。例如 `/api/users` 可匹配 `/api/users/123` 或 `/api/users/list`。'}
          {matchMode === 'wildcard' && '通配符匹配：支持 `:param` 路径参数和 `*` 通配符。例如 `/api/users/:id` 匹配 `/api/users/123`。'}
          {matchMode === 'regex' && '正则匹配：使用正则表达式匹配路径。例如 `/api/users/(\\d+)` 可匹配 `/api/users/123`。'}
        </div>
      </div>

      <div className="ad-section" style={{ marginTop: '0.75rem' }}>
        <div className="ad-section-head">
          <label>条件匹配</label>
          <div className="ad-rule-add-group">
            <button type="button" className="ad-btn ad-btn-sm" onClick={addCondition}>+ 添加条件</button>
          </div>
        </div>
        {conditions.length === 0 ? (
          <div className="ad-empty-hint">暂无匹配条件，所有符合路径规则的请求都将匹配</div>
        ) : (
          <div className="rules-list">
            {conditions.map((cond, idx) => (
              <div key={cond.id} className="rule-card">
                <span className="rule-index">{idx + 1}</span>
                <FormSelect className="rule-source" value={cond.source} options={COND_SOURCES} onChange={v => updateCondition(cond.id, 'source', v)} size="compact" />
                <input
                  className="rule-key"
                  value={cond.param}
                  onChange={e => updateCondition(cond.id, 'param', e.target.value)}
                  placeholder="参数名"
                />
                <FormSelect className="rule-operator" value={cond.operator} options={COND_OPERATORS} onChange={v => updateCondition(cond.id, 'operator', v)} size="compact" />
                {!['exists', 'not_exists'].includes(cond.operator) && (
                  <input
                    className="rule-expected"
                    value={cond.value}
                    onChange={e => updateCondition(cond.id, 'value', e.target.value)}
                    placeholder="期望值"
                  />
                )}
                <button type="button" className="rule-del" onClick={() => removeCondition(cond.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: 响应配置 ───
  const renderResponseTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>响应状态</label></div>
        <div className="api-detail-row">
          <div className="field" style={{ flex: '0 0 120px' }}>
            <label>状态码</label>
            <InlineText value={String(responseStatus)} onChange={v => { setResponseStatus(Number(v) || 200); dirtyRef(true); }} placeholder="200" />
          </div>
          <div className="field" style={{ flex: '0 0 140px' }}>
            <label>延迟 (ms)</label>
            <InlineText value={String(responseDelay)} onChange={v => { setResponseDelay(Number(v) || 0); dirtyRef(true); }} placeholder="0" />
          </div>
        </div>
      </div>

      <div className="ad-section" style={{ marginTop: '0.75rem' }}>
        <div className="ad-section-head"><label>响应头</label></div>
        <div className="ad-editor-section">
          <ThemedCodeMirror
            value={responseHeaders}
            height="120px"
            extensions={[json()]}
            onChange={v => { setResponseHeaders(v); dirtyRef(true); }}
          />
        </div>
      </div>

      <div className="ad-section" style={{ marginTop: '0.75rem' }}>
        <div className="ad-section-head"><label>响应体</label></div>
        <div className="ad-editor-section">
          <ThemedCodeMirror
            value={responseBody}
            height="300px"
            extensions={[json()]}
            onChange={v => { setResponseBody(v); dirtyRef(true); }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="api-detail page-enter">
      {/* Header */}
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={handleCancel}>Mock 列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={name} onChange={e => { setName(e.target.value); dirtyRef(true); }} placeholder="输入 Mock 名称" />
        </div>
        <div className="api-detail-meta">
          {!isNew && <span className={`status-badge-light ${status}`}>{STATUS_OPTIONS.find(o => o.value === status)?.label || status}</span>}
        </div>
        <div className="api-detail-actions">
          <button className={`scenario-btn${dirty ? ' dirty' : ''}`} onClick={doSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>

      {/* Content */}
      <div className="api-detail-content">
        <div className="api-detail-card">
          {/* Tab Nav */}
          <div className="tab-nav">
            {TABS.map(tab => (
              <button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Body */}
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'match' && renderMatchTab()}
            {activeTab === 'response' && renderResponseTab()}
          </div>
        </div>
      </div>

      
    </div>
  );
}