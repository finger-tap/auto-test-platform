import { useState, useEffect, Fragment, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import VarHoverTip from '../../components/VarHoverTip';
import MessageModal from '../../components/MessageModal';
import SelectFunctionModal from '../../components/SelectFunctionModal';
import type { ApiItem, ApiLog, AssertionRule, AssertionResult, DatabaseEntry } from '../../types';
import { PrePostActionList, defaultAction, type PrePostAction } from '../../components/PrePostActionItem';
import './ApiDetail.css';
import '../scenario/ScenarioDetail.css';

// 从环境配置解析数据库列表
const getDatabasesFromEnv = (env: any): string[] => {
  if (!env?.databases) return [];
  try {
    const dbs: DatabaseEntry[] = typeof env.databases === 'string' ? JSON.parse(env.databases) : env.databases;
    return dbs.map((db: DatabaseEntry) => db.name);
  } catch {
    return [];
  }
};

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const CONTENT_TYPES = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form' },
  { value: 'xml', label: 'XML' },
  { value: 'raw', label: 'Raw' },
];
const ASSERTION_SOURCES = [
  { value: 'status', label: '状态码' },
  { value: 'header', label: '响应头' },
  { value: 'body', label: '响应体' },
];
const ASSERTION_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'less_than', label: '小于' },
  { value: 'greater_than', label: '大于' },
  { value: 'exists', label: '存在' },
  { value: 'not_exists', label: '不存在' },
];
const BODY_HINTS: Record<string, string> = {
  json: '输入 JSON 格式内容，例如：{"name": "test"}',
  form: '输入表单格式内容，例如：username=admin&password=123',
  xml: '输入 XML 格式内容',
  raw: '输入纯文本内容',
};
const HEADER_HINT = '输入 JSON 格式请求头，例如：{"Authorization": "Bearer xxx", "Accept": "application/json"}';
const PROTOCOL_OPTIONS = [
  { value: 'https', label: 'HTTPS' },
  { value: 'http', label: 'HTTP' },
  { value: 'ws', label: 'WebSocket' },
];
const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];
const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'pre', label: '前置动作' },
  { key: 'main', label: '主体动作' },
  { key: 'post', label: '后置动作' },
  { key: 'final', label: '最终断言' },
  { key: 'logs', label: '执行记录' },
];
const defaultAssertion = (index: number): AssertionRule => ({ name: `规则${index}`, source: 'status', key: '', operator: 'equals', expected: '', assert: true });
const defaultRule = (index: number): AssertionRule => ({ name: `规则${index}`, source: 'status', key: '', operator: 'equals', expected: '', assert: false });
  const defaultAssertRule = (index: number): AssertionRule => ({ name: `规则${index}`, source: 'status', key: '', operator: 'equals', expected: '', assert: true });

function getEditorLang(ct: string): Extension[] {
  if (ct === 'json') return [json()];
  if (ct === 'xml') return [xml()];
  if (ct === 'form') return [javascript()];
  return [];
}

const tryFormatJson = (text: string | null) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

export default function ApiDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  const [api, setApi] = useState<ApiItem | null>(isNew ? {
    id: 0, user_id: 0, name: '', method: 'GET', url: '', protocol: 'https',
    headers: '', body: '', description: '', tags: '', status: 'draft',
    content_type: 'json', assertions: '[]',
    created_at: '', updated_at: '',
  } as ApiItem : null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ApiLog | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [error, setError] = useState('');
  const [modalMsg, setModalMsg] = useState('');
  const [modalType, setModalType] = useState<'error' | 'warning' | 'success'>('error');
  const [modalOpen, setModalOpen] = useState(false);
  const autoExecRef = useRef(false);
  const realIdRef = useRef<string | null>(isNew ? null : id!);
  const dirtyRef = useRef(false);
  const [activeTab, setActiveTab] = useState('detail');
  const [fnModalOpen, setFnModalOpen] = useState(false);
  const [fnTarget, setFnTarget] = useState<'pre_script' | 'post_script' | null>(null);

  // 前置/后置动作列表（组件化新格式）
  const [preActions, setPreActions] = useState<PrePostAction[]>([]);
  const [postActions, setPostActions] = useState<PrePostAction[]>([]);

  const [form, setForm] = useState({
    name: '', method: 'GET', url: '', protocol: 'https',
    headers: '', body: '', description: '', tags: '', status: 'draft',
    content_type: 'json', assertions: '[]',
    pre_script: '', post_script: '',
    pre_db_name: '', pre_db_query: '',
    post_db_name: '', post_db_query: '',
    pre_assertions: '[]',
    post_assertions: '[]',
    final_assertions: '[]',
    pre_actions: '[]',
    post_actions: '[]',
  });
  const [mainRules, setMainRules] = useState<AssertionRule[]>([]);
  const [preExtractionRules, setPreExtractionRules] = useState<AssertionRule[]>([]);
  const [preAssertionRules, setPreAssertionRules] = useState<AssertionRule[]>([]);
  const [postExtractionRules, setPostExtractionRules] = useState<AssertionRule[]>([]);
  const [postAssertionRules, setPostAssertionRules] = useState<AssertionRule[]>([]);
  const [finalAssertionRules, setFinalAssertionRules] = useState<AssertionRule[]>([]);
  const [mainEditingRuleIdx, setMainEditingRuleIdx] = useState<number | null>(null);
  // 前置动作规则编辑状态
  const [preEditingRuleIdx, setPreEditingRuleIdx] = useState<number | null>(null);
  // 后置动作规则编辑状态
  const [postEditingRuleIdx, setPostEditingRuleIdx] = useState<number | null>(null);
  // 最终断言规则编辑状态
  const [finalEditingRuleIdx, setFinalEditingRuleIdx] = useState<number | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');

  const ensureCreated = async (): Promise<string | null> => {
    if (realIdRef.current) return realIdRef.current;
    try {
      const payload = { ...form,
        assertions: JSON.stringify(mainRules),
        pre_assertions: JSON.stringify([...preExtractionRules, ...preAssertionRules]),
        post_assertions: JSON.stringify([...postExtractionRules, ...postAssertionRules]),
        final_assertions: JSON.stringify(finalAssertionRules),
      };
      const res = await apiFetch<{ id: number }>('/apis', { method: 'POST', body: JSON.stringify(payload) }) as { code: number; message?: string; data?: { id: number } };
      if (res.code === 201 && res.data) {
        realIdRef.current = String(res.data.id);
        navigate(`/api-test/api-case/${res.data.id}`, { replace: true });
        setApi(prev => prev ? { ...prev, id: res.data!.id } : prev);
        return realIdRef.current;
      }
      setModalType('error'); setModalMsg(res.message || '创建失败'); setModalOpen(true);
      return null;
    } catch (err) {
      setModalType('error'); setModalMsg(err instanceof Error ? err.message : '创建失败'); setModalOpen(true);
      return null;
    }
  };

  const { activeEnv } = useEnvironment();

  const handleExecute = async () => {
    if (!realIdRef.current) { setModalType('warning'); setModalMsg('请先保存案例后再执行'); setModalOpen(true); return; }
    setExecuting(true); setLastResult(null); setResultCollapsed(false);
    try {
      const res = await apiFetch<ApiLog>(`/apis/${realIdRef.current}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) }) as { code: number; data?: ApiLog };
      if (res.code === 200 && res.data) {
        setLastResult(res.data);
        const logsRes = await apiFetch<ApiLog[]>(`/apis/${realIdRef.current}/logs`) as { code: number; data?: ApiLog[] };
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Execute failed'); }
    finally { setExecuting(false); }
  };

  useEffect(() => {
    if (!id || isNew) return;
    apiFetch<ApiItem>(`/apis/${id}`).then((res) => {
      const r = res as { code: number; data?: ApiItem };
      if (r.code === 200 && r.data) {
        const d = r.data;
        setApi(d);
        setForm({
          name: d.name, method: d.method, url: d.url, protocol: d.protocol,
          headers: d.headers || '', body: d.body || '', description: d.description || '',
          tags: d.tags || '', status: d.status || 'active',
          content_type: d.content_type || 'json', assertions: d.assertions || '[]',
          pre_script: d.pre_script || '', post_script: d.post_script || '',
          pre_db_name: d.pre_db_name || '', pre_db_query: d.pre_db_query || '',
          post_db_name: d.post_db_name || '', post_db_query: d.post_db_query || '',
          pre_assertions: d.pre_assertions || '[]',
          post_assertions: d.post_assertions || '[]',
          final_assertions: d.final_assertions || '[]',
          pre_actions: d.pre_actions || '[]',
          post_actions: d.post_actions || '[]',
        });
        // 主体动作：所有规则合并存储
        try {
          setMainRules(JSON.parse(d.assertions || '[]'));
        } catch { setMainRules([]); }
        // 前置动作：拆分 pre_assertions 为提取 + 断言
        try {
          const allPreRules: AssertionRule[] = JSON.parse(d.pre_assertions || '[]');
          setPreExtractionRules(allPreRules.filter(r => r.assert === false));
          setPreAssertionRules(allPreRules.filter(r => r.assert !== false));
        } catch { setPreExtractionRules([]); setPreAssertionRules([]); }
        // 后置动作：拆分 post_assertions 为提取 + 断言
        try {
          const allPostRules: AssertionRule[] = JSON.parse(d.post_assertions || '[]');
          setPostExtractionRules(allPostRules.filter(r => r.assert === false));
          setPostAssertionRules(allPostRules.filter(r => r.assert !== false));
        } catch { setPostExtractionRules([]); setPostAssertionRules([]); }
        try { setFinalAssertionRules(JSON.parse(d.final_assertions || '[]')); } catch { setFinalAssertionRules([]); }
        // 前后置动作列表（组件化格式）
        try { setPreActions(JSON.parse(d.pre_actions || '[]')); } catch { setPreActions([]); }
        try { setPostActions(JSON.parse(d.post_actions || '[]')); } catch { setPostActions([]); }
        if (searchParams.get('exec') === '1' && !autoExecRef.current) { autoExecRef.current = true; handleExecute(); }
      }
    });
    apiFetch<ApiLog[]>(`/apis/${id}/logs`).then((res) => { const r = res as { code: number; data?: ApiLog[] }; if (r.code === 200 && r.data) setLogs(r.data); });
  }, [id]);

  

  const handleSave = async () => {
    setError('');
    const rid = await ensureCreated(); if (!rid) return;
    try {
      const payload = { ...form,
        assertions: JSON.stringify(mainRules),
        pre_assertions: JSON.stringify([...preExtractionRules, ...preAssertionRules]),
        post_assertions: JSON.stringify([...postExtractionRules, ...postAssertionRules]),
        final_assertions: JSON.stringify(finalAssertionRules),
        pre_actions: JSON.stringify(preActions),
        post_actions: JSON.stringify(postActions),
      };
      const res = await apiFetch(`/apis/${rid}`, { method: 'PUT', body: JSON.stringify(payload) }) as { code: number; message?: string };
      if (res.code !== 200) { setModalType('error'); setModalMsg(res.message || '保存失败'); setModalOpen(true); return; }
      setApi({ ...api!, ...payload, updated_at: new Date().toISOString() } as ApiItem);
      dirtyRef.current = false;
    } catch (err) { setModalType('error'); setModalMsg(err instanceof Error ? err.message : '保存失败'); setModalOpen(true); }
  };

  const handleFormat = useCallback((field: 'headers' | 'body') => {
    try { setForm({ ...form, [field]: JSON.stringify(JSON.parse(form[field]), null, 2) }); } catch { /* not JSON */ }
  }, [form]);

  if (!api) return <div className="api-empty">加载中...</div>;

  const statusClass = (code: number | null) => {
    if (!code) return 'status-0';
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400 && code < 500) return 'status-4xx';
    return 'status-5xx';
  };
  const opLabel = (op: string) => ASSERTION_OPERATORS.find(o => o.value === op)?.label || op;
  const srcLabel = (src: string) => ASSERTION_SOURCES.find(s => s.value === src)?.label || src;
  // Main rules helpers (提取+断言统一数组)
  const addMainRule = () => setMainRules([...mainRules, defaultAssertRule(mainRules.length + 1)]);
  const removeMainRule = (idx: number) => setMainRules(mainRules.filter((_, i) => i !== idx));
  const updateMainRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...mainRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setMainRules(updated); dirtyRef.current = true;
  };
  // Pre extraction helpers
  const addPreExtraction = () => setPreExtractionRules([...preExtractionRules, defaultRule(preExtractionRules.length + 1)]);
  const removePreExtraction = (idx: number) => setPreExtractionRules(preExtractionRules.filter((_, i) => i !== idx));
  const updatePreExtraction = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...preExtractionRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setPreExtractionRules(updated); dirtyRef.current = true;
  };
  // Pre assertion helpers
  const addPreRule = () => setPreAssertionRules([...preAssertionRules, defaultAssertion(preAssertionRules.length + 1)]);
  const removePreRule = (idx: number) => setPreAssertionRules(preAssertionRules.filter((_, i) => i !== idx));
  const updatePreRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...preAssertionRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setPreAssertionRules(updated); dirtyRef.current = true;
  };
  // Post extraction helpers
  const addPostExtraction = () => setPostExtractionRules([...postExtractionRules, defaultRule(postExtractionRules.length + 1)]);
  const removePostExtraction = (idx: number) => setPostExtractionRules(postExtractionRules.filter((_, i) => i !== idx));
  const updatePostExtraction = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...postExtractionRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setPostExtractionRules(updated); dirtyRef.current = true;
  };
  // Post assertion helpers
  const addPostRule = () => setPostAssertionRules([...postAssertionRules, defaultAssertion(postAssertionRules.length + 1)]);
  const removePostRule = (idx: number) => setPostAssertionRules(postAssertionRules.filter((_, i) => i !== idx));
  const updatePostRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...postAssertionRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setPostAssertionRules(updated); dirtyRef.current = true;
  };
  // Final assertion helpers
  const addFinalRule = () => setFinalAssertionRules([...finalAssertionRules, defaultAssertion(finalAssertionRules.length + 1)]);
  const removeFinalRule = (idx: number) => setFinalAssertionRules(finalAssertionRules.filter((_, i) => i !== idx));
  const updateFinalRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...finalAssertionRules]; updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setFinalAssertionRules(updated); dirtyRef.current = true;
  };
  // 统一切换规则校验状态（与 PrePostActionItem.toggleAssert 完全一致）
  const toggleMainRule = (idx: number) => {
    const rule = mainRules[idx];
    if (rule.assert !== false) {
      const updated = [...mainRules];
      updated[idx] = { ...rule, assert: false, operator: 'equals', expected: '' };
      setMainRules(updated); dirtyRef.current = true;
    } else {
      const updated = [...mainRules];
      updated[idx] = { ...rule, assert: true };
      setMainRules(updated); dirtyRef.current = true;
    }
  };
  const toggleFinalRule = (idx: number) => {
    const rule = finalAssertionRules[idx];
    if (rule.assert !== false) {
      const updated = [...finalAssertionRules];
      updated[idx] = { ...rule, assert: false, operator: 'equals', expected: '' };
      setFinalAssertionRules(updated); dirtyRef.current = true;
    } else {
      const updated = [...finalAssertionRules];
      updated[idx] = { ...rule, assert: true };
      setFinalAssertionRules(updated); dirtyRef.current = true;
    }
  };

  // Reusable rule card renderer (for both extraction and assertion) - uses tab-specific editing state
  const renderRuleCards = (
    rules: AssertionRule[],
    onAdd: () => void,
    onRemove: (idx: number) => void,
    onUpdate: (idx: number, field: keyof AssertionRule, value: string | boolean) => void,
    mode: 'extract' | 'assert',
    editingIdx: number | null,
    setEditingIdx: (idx: number | null) => void
  ) => (
    <>
      {rules.length === 0 && <div className="ad-empty-hint">{mode === 'extract' ? '暂无提取规则，点击"添加提取"创建。提取的变量可用于后续阶段。' : '暂无断言规则，点击"添加断言"创建。'}</div>}
      {rules.map((rule, idx) => (
        <div key={idx} className={`rule-card ${rule.assert === false ? 'rule-extract' : ''}`}>
          <span className="rule-index">{idx + 1}</span>
          {/* 规则名称：hover显示笔图标，点击编辑 */}
          {editingIdx === idx ? (
            <input className="main-rule-name-input" autoFocus value={rule.name || ''} placeholder={`规则 ${idx + 1}`}
              onChange={(e) => onUpdate(idx, 'name', e.target.value)} onBlur={() => setEditingIdx(null)} onKeyDown={(e) => { if (e.key === 'Enter') setEditingIdx(null); }} />
          ) : (
            <span className="main-rule-name" onClick={() => setEditingIdx(idx)}>
              {rule.name || `规则 ${idx + 1}`}
              <span className="main-rule-name-edit">✎</span>
            </span>
          )}
          <select value={rule.source} onChange={(e) => onUpdate(idx, 'source', e.target.value)}>{ASSERTION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <input className="rule-key" placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'} value={rule.key} onChange={(e) => onUpdate(idx, 'key', e.target.value)} disabled={rule.source === 'status'} />
          {mode === 'assert' && (
            <>
              {/* 校验开关：打开显示"检查"+下拉+输入框，关闭显示"提取"+隐藏下拉和输入框 */}
              <label className="rule-switch">
                <input type="checkbox" checked={rule.assert !== false} onChange={() => toggleFinalRule(idx)} />
                <span className="rule-switch-slider"><span className="rule-switch-label">{rule.assert !== false ? '检查' : '提取'}</span></span>
              </label>
              <select className="rule-operator" value={rule.operator} onChange={(e) => onUpdate(idx, 'operator', e.target.value)} style={{ display: rule.assert === false ? 'none' : undefined }}>{ASSERTION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              {rule.assert !== false && !['exists', 'not_exists'].includes(rule.operator) && (<input className="rule-expected" placeholder="期望值" value={rule.expected} onChange={(e) => onUpdate(idx, 'expected', e.target.value)} />)}
            </>
          )}
          {mode === 'extract' && (<span className="rule-extract-badge">提取</span>)}
          <button type="button" className="rule-del" onClick={() => onRemove(idx)}>✕</button>
        </div>
      ))}
    </>
  );

  const handleInsertFunction = (text: string) => {
    if (!fnTarget) return;
    setForm(f => ({ ...f, [fnTarget]: f[fnTarget] + text }));
    dirtyRef.current = true;
  };

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper tab-detail-wrapper">
      <div className="ad-section ad-section-fill">
        <div className="api-detail-row">
          <div className="field"><label>接口名称</label><InlineText value={form.name} onChange={v => { setForm(f => ({ ...f, name: v })); dirtyRef.current = true; }} placeholder="点击输入接口名称" /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>描述</label><InlineText value={form.description} onChange={v => { setForm(f => ({ ...f, description: v })); dirtyRef.current = true; }} placeholder="点击输入描述" multiline /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>标签</label><InlineText value={form.tags} onChange={v => { setForm(f => ({ ...f, tags: v })); dirtyRef.current = true; }} placeholder="点击输入标签" /></div>
          <div className="field"><label>状态</label><InlineSelect value={form.status} options={STATUS_OPTIONS} onChange={v => { setForm(f => ({ ...f, status: v })); dirtyRef.current = true; }} renderDisplay={(v, label) => <span className={`status-text status-${v}`}>{label}</span>} /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>创建时间</label><span className="field-value">{api.created_at ? api.created_at.replace('T', ' ').slice(0, 19) : '-'}</span></div>
          <div className="field"><label>更新时间</label><span className="field-value">{api.updated_at ? api.updated_at.replace('T', ' ').slice(0, 19) : '-'}</span></div>
        </div>
      </div>
    </div>
  );

  // ─── Tab: Pre-script ───
  const renderPreTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>前置动作</label></div>
        <PrePostActionList
          actions={preActions}
          onChange={(actions) => { setPreActions(actions); dirtyRef.current = true; }}
          onDirty={() => { dirtyRef.current = true; }}
          label="添加前置动作"
          databases={getDatabasesFromEnv(activeEnv)}
        />
      </div>
    </div>
  );

  // ─── Tab: Main ───
  const renderMainTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>请求配置</label></div>
        <div className="api-detail-row">
          <div className="field"><label>请求方法</label><InlineSelect value={form.method} options={METHODS.map(m => ({ value: m, label: m }))} onChange={v => { setForm(f => ({ ...f, method: v })); dirtyRef.current = true; }} renderDisplay={(v) => <span className={`method-badge method-${v}`}>{v}</span>} /></div>
          <div className="field"><label>协议</label><InlineSelect value={form.protocol} options={PROTOCOL_OPTIONS} onChange={v => { setForm(f => ({ ...f, protocol: v })); dirtyRef.current = true; }} /></div>
        </div>
        <div className="api-detail-row">
          <div className="field field-url"><label>请求地址</label>
            <span className="ie-field ie-mono url-editable" onClick={() => setEditingUrl(true)}>
              <VarHoverTip text={form.url} className="ie-url-display" />
              <span className="ie-icon">✎</span>
            </span>
            {editingUrl && (
              <input
                className="ie-input url-input"
                value={draftUrl}
                onChange={e => { setDraftUrl(e.target.value); dirtyRef.current = true; }}
                onBlur={() => { if (draftUrl !== form.url) { setForm(f => ({ ...f, url: draftUrl })); dirtyRef.current = true; } setEditingUrl(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setForm(f => ({ ...f, url: draftUrl }));
                    dirtyRef.current = true;
                    setEditingUrl(false);
                  }
                  if (e.key === 'Escape') { setEditingUrl(false); setDraftUrl(form.url); }
                }}
                placeholder="点击输入请求地址"
                autoFocus
              />
            )}
          </div>
        </div>
        <div className="ad-editor-section">
          <div className="ad-editor-label"><label>请求头</label><button type="button" className="ad-btn ad-btn-sm" onClick={() => handleFormat('headers')}>格式化</button></div>
          <CodeMirror value={form.headers} height="120px" extensions={[json(), linter(jsonParseLinter())]} onChange={(val) => { setForm({ ...form, headers: val }); dirtyRef.current = true; }} placeholder={HEADER_HINT} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }} />
        </div>
        <div className="api-detail-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>报文类型</label>
            <div className="ad-ct-row">
              {CONTENT_TYPES.map((ct) => (<button key={ct.value} type="button" className={`ad-ct-btn ${form.content_type === ct.value ? 'active' : ''}`} onClick={() => { setForm({ ...form, content_type: ct.value }); dirtyRef.current = true; }}>{ct.label}</button>))}
              <span className="ad-body-hint">{BODY_HINTS[form.content_type]}</span>
            </div>
          </div>
        </div>
        <div className="ad-editor-section">
          <div className="ad-editor-label"><label>请求体</label><button type="button" className="ad-btn ad-btn-sm" onClick={() => handleFormat('body')}>格式化</button></div>
          <CodeMirror value={form.body} height="200px" extensions={getEditorLang(form.content_type) || []} onChange={(val) => { setForm({ ...form, body: val }); dirtyRef.current = true; }} placeholder={BODY_HINTS[form.content_type]} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }} />
        </div>
      </div>

      {/* 提取 & 断言 */}
      <div className="ad-section">
        <div className="ad-section-head">
          <label>提取 & 断言</label>
        </div>
        <div className="rules-list">
          {mainRules.map((rule, idx) => (
            <div key={idx} className={`rule-card ${rule.assert === false ? 'rule-extract' : 'rule-assert'}`}>
              <span className="rule-index">{idx + 1}</span>
              {mainEditingRuleIdx === idx ? (
                <input
                  className="main-rule-name-input"
                  autoFocus
                  value={rule.name || ''}
                  placeholder={`规则 ${idx + 1}`}
                  onChange={(e) => { const u = [...mainRules]; u[idx] = { ...u[idx], name: e.target.value }; setMainRules(u); dirtyRef.current = true; }}
                  onBlur={() => setMainEditingRuleIdx(null)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setMainEditingRuleIdx(null); }}
                />
              ) : (
                <span className="main-rule-name" onClick={() => setMainEditingRuleIdx(idx)}>
                  {rule.name || `规则${idx + 1}`}
                  <span className="main-rule-name-edit">✎</span>
                </span>
              )}
              <select value={rule.source} onChange={(e) => updateMainRule(idx, 'source', e.target.value)}>{ASSERTION_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <input className="rule-key" placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'} value={rule.key} onChange={(e) => updateMainRule(idx, 'key', e.target.value)} disabled={rule.source === 'status'} />
              {/* 校验开关：开关控制后面operator和expected的显示，关闭时清空值 */}
              <label className="rule-switch">
                <input
                  type="checkbox"
                  checked={rule.assert !== false}
                  onChange={() => toggleMainRule(idx)}
                />
                <span className="rule-switch-slider">
                  {rule.assert !== false ? <span className="rule-switch-label">检查</span> : <span className="rule-switch-label">提取</span>}
                </span>
              </label>
              {rule.assert !== false && (
                <>
                  <select value={rule.operator} onChange={(e) => updateMainRule(idx, 'operator', e.target.value)}>{ASSERTION_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  {!['exists', 'not_exists'].includes(rule.operator) && (<input className="rule-expected" placeholder="期望值" value={rule.expected} onChange={(e) => updateMainRule(idx, 'expected', e.target.value)} />)}
                </>
              )}
              <button type="button" className="rule-del" onClick={() => removeMainRule(idx)}>✕</button>
            </div>
          ))}
          {mainRules.length === 0 && (
            <div style={{ fontSize: '0.75rem', color: '#bbb', marginBottom: 8 }}>暂无提取和断言规则</div>
          )}
        </div>
        <button type="button" className="ad-btn ad-btn-sm" style={{ marginTop: 8, display: 'block' }} onClick={() => { addMainRule(); dirtyRef.current = true; }}>+ 添加规则</button>
      </div>
    </div>
  );

  // ─── Tab: Post-script ───
  const renderPostTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>后置动作</label></div>
        <PrePostActionList
          actions={postActions}
          onChange={(actions) => { setPostActions(actions); dirtyRef.current = true; }}
          onDirty={() => { dirtyRef.current = true; }}
          label="添加后置动作"
          databases={getDatabasesFromEnv(activeEnv)}
        />
      </div>
    </div>
  );

  // ─── Tab: Final ───
  const renderFinalTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>最终断言</label></div>
        {renderRuleCards(finalAssertionRules, addFinalRule, removeFinalRule, updateFinalRule, 'assert', finalEditingRuleIdx, setFinalEditingRuleIdx)}
        <button type="button" className="ad-btn ad-btn-sm" style={{ marginTop: 8, display: 'block' }} onClick={addFinalRule}>+ 添加断言</button>
      </div>
    </div>
  );

  // Helper to render assertion results (handles both old array and new multi-stage format)
  const renderAssertionResults = (results: AssertionResult[] | { main?: AssertionResult[]; pre?: AssertionResult[]; post?: AssertionResult[]; final?: AssertionResult[] } | null) => {
    if (!results) return null;
    // Multi-stage format
    if ('main' in results || 'pre' in results || 'post' in results || 'final' in results) {
      const stageResults = results as { main?: AssertionResult[]; pre?: AssertionResult[]; post?: AssertionResult[]; final?: AssertionResult[] };
      const stages = [
        { key: 'pre', label: '前置', hasExtract: true },
        { key: 'main', label: '主体', hasExtract: true },
        { key: 'post', label: '后置', hasExtract: true },
        { key: 'final', label: '最终', hasExtract: false },
      ] as const;

      const renderResultItems = (arr: AssertionResult[]) => arr.map((ar, i) => (
        <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
          <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
          <div className="ad-ar-detail">
            {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
            <div className="ad-ar-row"><span className="ad-ar-label">提取:</span><span>{srcLabel(ar.rule.source)}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span><span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span><span className="ad-ar-extract-val">{ar.actual}</span></div>
            {ar.rule.assert !== false && <div className="ad-ar-row"><span className="ad-ar-label">校验:</span><span className="ad-ar-check-text">{opLabel(ar.rule.operator)} {ar.rule.expected || ''}</span></div>}
          </div>
        </div>
      ));

      return (
        <div className="ad-assertion-results-multi">
          {stages.map(s => {
            const stageArr = stageResults[s.key];
            if (!stageArr || stageArr.length === 0) return null;
            const extractArr = stageArr.filter(a => a.rule.assert === false);
            const assertArr = stageArr.filter(a => a.rule.assert !== false);

            return (
              <div key={s.key} className="ad-assertion-stage">
                <div className="ad-assertion-stage-header">
                  <span className="stage-label">{s.label}阶段</span>
                  <span className={`stage-count ${assertArr.every(a => a.passed) ? 'all-pass' : 'has-fail'}`}>{assertArr.filter(a => a.passed).length}/{assertArr.length} 断言通过</span>
                </div>
                {s.hasExtract && extractArr.length > 0 && (
                  <div className="ad-sub-stage">
                    <div className="ad-sub-stage-label">提取变量</div>
                    <div className="ad-assertion-results">{renderResultItems(extractArr)}</div>
                  </div>
                )}
                <div className="ad-sub-stage">
                  <div className="ad-sub-stage-label">断言</div>
                  <div className="ad-assertion-results">{renderResultItems(assertArr)}</div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    // Old flat array format
    const flatArr = results as AssertionResult[];
    return (
      <div className="ad-assertion-results">{flatArr.map((ar, i) => (
        <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
          <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
          <div className="ad-ar-detail">
            {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
            <div className="ad-ar-row"><span className="ad-ar-label">提取:</span><span>{srcLabel(ar.rule.source)}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span><span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span><span className="ad-ar-extract-val">{ar.actual}</span></div>
            {ar.rule.assert !== false && <div className="ad-ar-row"><span className="ad-ar-label">校验:</span><span className="ad-ar-check-text">{opLabel(ar.rule.operator)} {ar.rule.expected || ''}</span></div>}
          </div>
        </div>
      ))}</div>
    );
  };

  // Helper to parse assertion results from various formats
  const parseAssertionResults = (data: unknown): AssertionResult[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data as AssertionResult[];
    if (typeof data === 'object' && data !== null && 'main' in data) {
      const stageData = data as { main?: AssertionResult[]; pre?: AssertionResult[]; post?: AssertionResult[]; final?: AssertionResult[] };
      // For summary count, count all assertion rules (not extract-only)
      const all = [...(stageData.main || []), ...(stageData.pre || []), ...(stageData.post || []), ...(stageData.final || [])];
      return all;
    }
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return []; }
    }
    return [];
  };

  // Helper to get summary count from various formats
  const getAssertionSummary = (data: unknown) => {
    if (!data) return null;
    if (typeof data === 'object' && data !== null && 'main' in data) {
      const stageData = data as { main?: AssertionResult[]; pre?: AssertionResult[]; post?: AssertionResult[]; final?: AssertionResult[] };
      const all = [...(stageData.main || []), ...(stageData.pre || []), ...(stageData.post || []), ...(stageData.final || [])];
      const pass = all.filter(a => a.passed).length;
      const total = all.filter(a => a.rule.assert !== false).length;
      return { pass, total };
    }
    if (typeof data === 'string') {
      try {
        const arr: AssertionResult[] = JSON.parse(data);
        return { pass: arr.filter(a => a.passed).length, total: arr.filter(a => a.rule.assert !== false).length };
      } catch { return null; }
    }
    return null;
  };

  // ─── Tab: Logs ───
  const renderLogsTab = () => (
    <div className="tab-content-wrapper">
      {lastResult && (
        <div className="ad-section">
          <div className="ad-section-head"><label>最近执行结果</label><button className="ad-btn ad-btn-sm" onClick={() => setResultCollapsed(!resultCollapsed)}>{resultCollapsed ? '展开' : '收起'}</button></div>
          <div className="exec-result">
            <div className="exec-result-header">
              <span className={`status-badge ${statusClass(lastResult.status_code)}`}>{lastResult.status_code || 'Error'}</span>
              {lastResult.duration_ms != null && <span className="duration-badge">{lastResult.duration_ms} ms</span>}
              {lastResult.executed_by && <span className="exec-user">执行人：{lastResult.executed_by}</span>}
            </div>
            {!resultCollapsed && (
              <div className="log-detail-sections">
                <div className="log-section"><div className="log-section-header">请求头</div><div className="log-section-content"><CodeMirror value={tryFormatJson(lastResult.request_headers)} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                <div className="log-section"><div className="log-section-header">请求报文</div><div className="log-section-content"><CodeMirror value={tryFormatJson(lastResult.request_body) || '(空)'} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                <div className="log-section"><div className="log-section-header">响应头</div><div className="log-section-content"><CodeMirror value={tryFormatJson(lastResult.response_headers)} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                <div className="log-section"><div className="log-section-header">响应报文</div><div className="log-section-content"><CodeMirror value={tryFormatJson(lastResult.response_body)} height="auto" maxHeight="300px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                <div className="log-section">
                  <div className="log-section-header">提取和断言{(() => { const s = getAssertionSummary(lastResult.assertion_results); return s ? (<span className="log-assert-summary">({s.pass}/{s.total} 通过)</span>) : null; })()}</div>
                  <div className="log-section-content">
                    {(() => { const results = parseAssertionResults(lastResult.assertion_results); return results.length > 0 ? renderAssertionResults(lastResult.assertion_results) : <div className="ad-empty-hint">暂无数据</div>; })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="ad-section">
        <div className="ad-section-head"><label>执行历史</label></div>
        {logs.length === 0 ? (<div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>) : (
          <table className="log-table">
            <thead><tr><th>时间</th><th>状态码</th><th>耗时</th><th>执行人</th><th>断言</th><th>操作</th></tr></thead>
            <tbody>{logs.map((log) => {
              const summary = getAssertionSummary(log.assertion_results);
              const passCount = summary ? summary.pass : 0;
              const totalCount = summary ? summary.total : 0;
              return (
                <Fragment key={log.id}>
                  <tr>
                    <td>{log.executed_at.replace('T', ' ').slice(0, 19)}</td>
                    <td><span className={`status-badge ${statusClass(log.status_code)}`}>{log.status_code || 'Error'}</span></td>
                    <td>{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</td>
                    <td>{log.executed_by || '-'}</td>
                    <td>{totalCount > 0 ? (<span className={passCount === totalCount ? 'assert-pass' : 'assert-fail'}>{passCount}/{totalCount}</span>) : '-'}</td>
                    <td><button className="log-view-btn" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>{expandedLog === log.id ? '收起' : '查看'}</button></td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr><td colSpan={6} className="log-expanded">
                      <div className="log-detail-sections">
                        <div className="log-section"><div className="log-section-header">请求头</div><div className="log-section-content"><CodeMirror value={tryFormatJson(log.request_headers)} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                        <div className="log-section"><div className="log-section-header">请求报文</div><div className="log-section-content"><CodeMirror value={tryFormatJson(log.request_body) || '(空)'} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                        <div className="log-section"><div className="log-section-header">响应头</div><div className="log-section-content"><CodeMirror value={tryFormatJson(log.response_headers)} height="auto" maxHeight="200px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                        <div className="log-section"><div className="log-section-header">响应报文</div><div className="log-section-content"><CodeMirror value={tryFormatJson(log.response_body)} height="auto" maxHeight="300px" extensions={[json()]} editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} /></div></div>
                        <div className="log-section">
                          <div className="log-section-header">提取和断言{summary && (<span className="log-assert-summary">({summary.pass}/{summary.total} 通过)</span>)}</div>
                          <div className="log-section-content">
                            {(() => { const results = parseAssertionResults(log.assertion_results); return results.length > 0 ? renderAssertionResults(log.assertion_results) : <div className="ad-empty-hint">暂无数据</div>; })()}
                          </div>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="api-detail">
      <div className="api-detail-header">
        <button className="api-detail-back" onClick={() => navigate('/api-test/api-case')}>← 返回列表</button>
        <span className="api-detail-page-title">接口用例详情</span>
      </div>
      <div className="api-detail-content">
        <div className="api-detail-card" style={{ padding: 0 }}>
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'pre' && renderPreTab()}
            {activeTab === 'main' && renderMainTab()}
            {activeTab === 'post' && renderPostTab()}
            {activeTab === 'final' && renderFinalTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
          {activeTab !== 'logs' && (
            <div className="detail-action-bar">
              <button className={`scenario-btn ${dirtyRef.current ? 'dirty' : ''}`} onClick={handleSave}>保存</button>
              <button className={`scenario-btn scenario-btn-primary ${!realIdRef.current ? 'scenario-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>{executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}</button>
            </div>
          )}
        </div>
      </div>
      {error && <div className="api-error">{error}</div>}
      <MessageModal open={modalOpen} message={modalMsg} type={modalType} onClose={() => setModalOpen(false)} />
      <SelectFunctionModal
        open={fnModalOpen}
        onClose={() => setFnModalOpen(false)}
        onInsert={handleInsertFunction}
      />
    </div>
  );
}
