import { useState, useEffect, Fragment, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { apiFetch } from '../../utils/api';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import MessageModal from '../../components/MessageModal';
import PreActionSection from './PreActionSection';
import type { ApiItem, ApiLog, AssertionRule, AssertionResult } from '../../types';
import './ApiDetail.css';

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

const defaultAssertion = (index: number): AssertionRule => ({ name: `规则${index}`, source: 'status', key: '', operator: 'equals', expected: '', assert: true });

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
  const [saved, setSaved] = useState(false);
  const autoExecRef = useRef(false);
  const realIdRef = useRef<string | null>(isNew ? null : id!);

  const [form, setForm] = useState({
    name: '', method: 'GET', url: '', protocol: 'https',
    headers: '', body: '', description: '', tags: '', status: 'draft',
    content_type: 'json', assertions: '[]',
  });

  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>([]);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);

  // Ensure the API record exists (POST first if new). Returns the real ID.
  const ensureCreated = async (): Promise<string | null> => {
    if (realIdRef.current) return realIdRef.current;
    try {
      const payload = { ...form, assertions: JSON.stringify(assertionRules) };
      const res = await apiFetch<{ id: number }>('/apis', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.code === 201 && res.data) {
        realIdRef.current = String(res.data.id);
        navigate(`/api-test/${res.data.id}`, { replace: true });
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

  const handleExecute = async () => {
    if (!realIdRef.current) {
      setModalType('warning'); setModalMsg('请先保存案例后再执行'); setModalOpen(true);
      return;
    }
    setExecuting(true);
    setLastResult(null);
    setResultCollapsed(false);
    try {
      const res = await apiFetch<ApiLog>(`/apis/${realIdRef.current}/execute`, { method: 'POST' });
      if (res.code === 200 && res.data) {
        setLastResult(res.data);
        const logsRes = await apiFetch<ApiLog[]>(`/apis/${realIdRef.current}/logs`);
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setExecuting(false);
    }
  };

  useEffect(() => {
    if (!id || isNew) return;
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
          content_type: res.data.content_type || 'json',
          assertions: res.data.assertions || '[]',
        });
        try { setAssertionRules(JSON.parse(res.data.assertions || '[]')); } catch { setAssertionRules([]); }

        // Auto-execute if coming from list page exec button
        if (searchParams.get('exec') === '1' && !autoExecRef.current) {
          autoExecRef.current = true;
          handleExecute();
        }
      }
    });
    apiFetch<ApiLog[]>(`/apis/${id}/logs`).then((res) => {
      if (res.code === 200 && res.data) setLogs(res.data);
    });
  }, [id]);

  // Auto-save a single field
  const saveField = async (field: string, value: string) => {
    const updatedForm = { ...form, [field]: value };
    setForm(updatedForm);
    const rid = await ensureCreated();
    if (!rid) return;
    try {
      const payload = { ...updatedForm, assertions: JSON.stringify(assertionRules) };
      const res = await apiFetch(`/apis/${rid}`, { method: 'PUT', body: JSON.stringify(payload) });
      if (res.code === 200) {
        setApi({ ...api!, ...payload, updated_at: new Date().toISOString() } as ApiItem);
      } else {
        setModalType('error'); setModalMsg(res.message || '保存失败'); setModalOpen(true);
      }
    } catch (err) {
      setModalType('error'); setModalMsg(err instanceof Error ? err.message : '保存失败'); setModalOpen(true);
    }
  };

  // Full save (for headers/body/assertions)
  const handleSave = async () => {
    setError('');
    const rid = await ensureCreated();
    if (!rid) return;
    try {
      const payload = { ...form, assertions: JSON.stringify(assertionRules) };
      const res = await apiFetch(`/apis/${rid}`, { method: 'PUT', body: JSON.stringify(payload) });
      if (res.code !== 200) { setModalType('error'); setModalMsg(res.message || '保存失败'); setModalOpen(true); return; }
      setApi({ ...api!, ...payload, updated_at: new Date().toISOString() } as ApiItem);
      setSaved(true);
    } catch (err) {
      setModalType('error'); setModalMsg(err instanceof Error ? err.message : '保存失败'); setModalOpen(true);
    }
  };

  const handleFormat = useCallback((field: 'headers' | 'body') => {
    try {
      const formatted = JSON.stringify(JSON.parse(form[field]), null, 2);
      setForm({ ...form, [field]: formatted });
    } catch { /* not JSON, ignore */ }
  }, [form]);

  if (!api) return <div className="api-empty">加载中...</div>;

  const statusClass = (code: number | null) => {
    if (!code) return 'status-0';
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400 && code < 500) return 'status-4xx';
    return 'status-5xx';
  };

  const contentTypeLabel = (ct: string | null) => CONTENT_TYPES.find(c => c.value === ct)?.label || 'JSON';

  const addRule = () => setAssertionRules([...assertionRules, defaultAssertion(assertionRules.length + 1)]);
  const removeRule = (idx: number) => setAssertionRules(assertionRules.filter((_, i) => i !== idx));
  const updateRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...assertionRules];
    updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setAssertionRules(updated);
  };

  const opLabel = (op: string) => ASSERTION_OPERATORS.find(o => o.value === op)?.label || op;
  const srcLabel = (src: string) => ASSERTION_SOURCES.find(s => s.value === src)?.label || src;

  return (
    <div className="api-detail">
      <button className="api-detail-back" onClick={() => navigate('/api-test')}>
        ← 返回列表
      </button>

      {/* ── Config Card ── */}
      <div className="api-detail-card">
        <div className="api-detail-card-head">
          <h3>接口配置</h3>
          <div className="ad-head-actions">
            <button className="ad-btn ad-btn-default" onClick={handleSave}>保存</button>
            <button className={`ad-btn ad-btn-primary ${!realIdRef.current ? 'ad-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>
              {executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}
            </button>
          </div>
        </div>

        {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 16 }}>
          {/* Basic info — inline editable */}
          <div className="api-detail-row">
            <div className="field">
              <label>接口名称</label>
              <InlineText value={form.name} onSave={v => saveField('name', v)} placeholder="点击输入接口名称" />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>描述</label>
              <InlineText value={form.description} onSave={v => saveField('description', v)} placeholder="点击输入描述" multiline />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>请求方法</label>
              <InlineSelect
                value={form.method}
                options={METHODS.map(m => ({ value: m, label: m }))}
                onSave={v => saveField('method', v)}
                renderDisplay={(v) => <span className={`method-badge method-${v}`}>{v}</span>}
              />
            </div>
            <div className="field">
              <label>协议</label>
              <InlineSelect
                value={form.protocol}
                options={PROTOCOL_OPTIONS}
                onSave={v => saveField('protocol', v)}
              />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>请求地址</label>
              <InlineText value={form.url} onSave={v => saveField('url', v)} placeholder="点击输入请求地址" monospace />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>标签</label>
              <InlineText value={form.tags} onSave={v => saveField('tags', v)} placeholder="点击输入标签" />
            </div>
            <div className="field">
              <label>状态</label>
              <InlineSelect
                value={form.status}
                options={STATUS_OPTIONS}
                onSave={v => saveField('status', v)}
                renderDisplay={(v, label) => <span className={`status-text status-${v}`}>{label}</span>}
              />
            </div>
          </div>

          {/* Headers Editor */}
          <div className="ad-editor-section">
            <div className="ad-editor-label">
              <label>请求头</label>
              <button type="button" className="ad-btn ad-btn-sm" onClick={() => handleFormat('headers')}>格式化</button>
            </div>
            <CodeMirror
              value={form.headers}
              height="120px"
              extensions={[json(), linter(jsonParseLinter())]}
              onChange={(val) => setForm({ ...form, headers: val })}
              placeholder={HEADER_HINT}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }}
            />
          </div>

          {/* Content Type selector */}
          <div className="api-detail-row" style={{ marginTop: 12 }}>
            <div className="field">
              <label>报文类型</label>
              <div className="ad-ct-row">
                {CONTENT_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    type="button"
                    className={`ad-ct-btn ${form.content_type === ct.value ? 'active' : ''}`}
                    onClick={() => setForm({ ...form, content_type: ct.value })}
                  >
                    {ct.label}
                  </button>
                ))}
                <span className="ad-body-hint">{BODY_HINTS[form.content_type]}</span>
              </div>
            </div>
          </div>

          {/* Body Editor */}
          <div className="ad-editor-section">
            <div className="ad-editor-label">
              <label>请求体</label>
              <button type="button" className="ad-btn ad-btn-sm" onClick={() => handleFormat('body')}>格式化</button>
            </div>
            <CodeMirror
              value={form.body}
              height="160px"
              extensions={getEditorLang(form.content_type) || []}
              onChange={(val) => setForm({ ...form, body: val })}
              placeholder={BODY_HINTS[form.content_type]}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }}
            />
          </div>

          {/* Extraction and Assertion Rules */}
          <div className="ad-section">
            <div className="ad-section-head">
              <label>提取和断言</label>
              <button type="button" className="ad-btn ad-btn-sm" onClick={addRule}>+ 添加规则</button>
            </div>
            {assertionRules.length === 0 && <div className="ad-empty-hint">暂无规则，点击"添加规则"。提取的参数可用于后续接口和条件判断。</div>}
            {assertionRules.map((rule, idx) => (
              <div key={idx} className={`ad-rule-card ${rule.assert === false ? 'assert-off' : ''}`}>
                {/* Name */}
                <div className="ad-rule-name">
                  {editingNameIdx === idx ? (
                    <input
                      className="ad-rule-name-input"
                      autoFocus
                      value={rule.name || ''}
                      placeholder={`规则 ${idx + 1}`}
                      onChange={(e) => updateRule(idx, 'name', e.target.value)}
                      onBlur={() => setEditingNameIdx(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditingNameIdx(null); }}
                    />
                  ) : (
                    <span className="ad-rule-name-text" onClick={() => setEditingNameIdx(idx)}>
                      {rule.name || `规则 ${idx + 1}`}
                      <span className="ad-rule-name-edit">✎</span>
                    </span>
                  )}
                </div>

                {/* Extraction */}
                <div className="ad-rule-row">
                  <select value={rule.source} onChange={(e) => updateRule(idx, 'source', e.target.value)}>
                    {ASSERTION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <input
                    className="ad-rule-key"
                    placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'}
                    value={rule.key}
                    onChange={(e) => updateRule(idx, 'key', e.target.value)}
                    disabled={rule.source === 'status'}
                  />

                  {/* Assert toggle + assertion fields inline */}
                  <label className="ad-rule-switch">
                    <input
                      type="checkbox"
                      checked={rule.assert !== false}
                      onChange={(e) => updateRule(idx, 'assert', e.target.checked)}
                    />
                    <span className="ad-rule-switch-slider" />
                  </label>

                  {rule.assert !== false && (
                    <>
                      <span className="ad-rule-arrow">→</span>
                      <select value={rule.operator} onChange={(e) => updateRule(idx, 'operator', e.target.value)}>
                        {ASSERTION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {!['exists', 'not_exists'].includes(rule.operator) && (
                        <input className="ad-rule-expected" placeholder="期望值" value={rule.expected} onChange={(e) => updateRule(idx, 'expected', e.target.value)} />
                      )}
                    </>
                  )}

                  <button type="button" className="ad-btn-del" onClick={() => removeRule(idx)}>✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Pre-Action Section */}
          <PreActionSection apiId={(api?.id && api.id > 0) ? api.id : null} saved={saved} />
        </div>
      </div>

      {/* ── Execute Result ── */}
      {lastResult && (
        <div className="api-detail-card">
          <div className="api-detail-card-head">
            <h3>执行结果</h3>
            <button className="ad-btn ad-btn-sm" onClick={() => setResultCollapsed(!resultCollapsed)}>
              {resultCollapsed ? '展开' : '收起'}
            </button>
          </div>
          <div className="exec-result">
            <div className="exec-result-header">
              <span className={`status-badge ${statusClass(lastResult.status_code)}`}>
                {lastResult.status_code || 'Error'}
              </span>
              {lastResult.duration_ms != null && (
                <span className="duration-badge">{lastResult.duration_ms} ms</span>
              )}
              {lastResult.executed_by && (
                <span className="exec-user">执行人：{lastResult.executed_by}</span>
              )}
            </div>

            {!resultCollapsed && (
              <div className="log-detail-sections">
                {/* 请求头 */}
                <div className="log-section">
                  <div className="log-section-header">请求头</div>
                  <div className="log-section-content">
                    <CodeMirror
                      value={tryFormatJson(lastResult.request_headers)}
                      height="auto"
                      maxHeight="200px"
                      extensions={[json()]}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                    />
                  </div>
                </div>

                {/* 请求报文 */}
                <div className="log-section">
                  <div className="log-section-header">请求报文</div>
                  <div className="log-section-content">
                    <CodeMirror
                      value={tryFormatJson(lastResult.request_body) || '(空)'}
                      height="auto"
                      maxHeight="200px"
                      extensions={[json()]}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                    />
                  </div>
                </div>

                {/* 响应头 */}
                <div className="log-section">
                  <div className="log-section-header">响应头</div>
                  <div className="log-section-content">
                    <CodeMirror
                      value={tryFormatJson(lastResult.response_headers)}
                      height="auto"
                      maxHeight="200px"
                      extensions={[json()]}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                    />
                  </div>
                </div>

                {/* 响应报文 */}
                <div className="log-section">
                  <div className="log-section-header">响应报文</div>
                  <div className="log-section-content">
                    <CodeMirror
                      value={tryFormatJson(lastResult.response_body)}
                      height="auto"
                      maxHeight="300px"
                      extensions={[json()]}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                    />
                  </div>
                </div>

                {/* 参数提取 & 检查点校验 */}
                <div className="log-section">
                  <div className="log-section-header">
                    提取和断言
                    {lastResult.assertion_results && lastResult.assertion_results.length > 0 && (
                      <span className="log-assert-summary">
                        ({lastResult.assertion_results.filter(r => r.rule.assert !== false && r.passed).length}/{lastResult.assertion_results.filter(r => r.rule.assert !== false).length} 通过)
                      </span>
                    )}
                  </div>
                  <div className="log-section-content">
                    {lastResult.assertion_results && lastResult.assertion_results.length > 0 ? (
                      <div className="ad-assertion-results">
                        {lastResult.assertion_results.map((ar, i) => (
                          <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
                            <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
                            <div className="ad-ar-detail">
                              {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
                              <div className="ad-ar-row">
                                <span className="ad-ar-label">提取:</span>
                                <span>{srcLabel(ar.rule.source)}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span>
                                <span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span>
                                <span className="ad-ar-extract-val">{ar.actual}</span>
                              </div>
                              {ar.rule.assert !== false && (
                                <div className="ad-ar-row">
                                  <span className="ad-ar-label">校验:</span>
                                  <span className="ad-ar-check-text">{opLabel(ar.rule.operator)} {ar.rule.expected || ''}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ad-empty-hint">暂无数据</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Logs Card ── */}
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
                <th>执行人</th>
                <th>断言</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                let logAssertions: AssertionResult[] = [];
                try { logAssertions = log.assertion_results ? JSON.parse(log.assertion_results as unknown as string) : []; } catch { /* */ }
                const passCount = logAssertions.filter(a => a.passed).length;
                return (
                  <Fragment key={log.id}>
                    <tr>
                      <td>{log.executed_at.replace('T', ' ').slice(0, 19)}</td>
                      <td><span className={`status-badge ${statusClass(log.status_code)}`}>{log.status_code || 'Error'}</span></td>
                      <td>{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</td>
                      <td>{log.executed_by || '-'}</td>
                      <td>{logAssertions.length > 0 ? (
                        <span className={passCount === logAssertions.length ? 'assert-pass' : 'assert-fail'}>
                          {passCount}/{logAssertions.length}
                        </span>
                      ) : '-'}</td>
                      <td>
                        <button className="log-view-btn" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                          {expandedLog === log.id ? '收起' : '查看'}
                        </button>
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr>
                        <td colSpan={6} className="log-expanded">
                          <div className="log-detail-sections">
                            {/* 请求头 */}
                            <div className="log-section">
                              <div className="log-section-header">请求头</div>
                              <div className="log-section-content">
                                <CodeMirror
                                  value={tryFormatJson(log.request_headers)}
                                  height="auto"
                                  maxHeight="200px"
                                  extensions={[json()]}
                                  editable={false}
                                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                                />
                              </div>
                            </div>

                            {/* 请求报文 */}
                            <div className="log-section">
                              <div className="log-section-header">请求报文</div>
                              <div className="log-section-content">
                                <CodeMirror
                                  value={tryFormatJson(log.request_body) || '(空)'}
                                  height="auto"
                                  maxHeight="200px"
                                  extensions={[json()]}
                                  editable={false}
                                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                                />
                              </div>
                            </div>

                            {/* 响应头 */}
                            <div className="log-section">
                              <div className="log-section-header">响应头</div>
                              <div className="log-section-content">
                                <CodeMirror
                                  value={tryFormatJson(log.response_headers)}
                                  height="auto"
                                  maxHeight="200px"
                                  extensions={[json()]}
                                  editable={false}
                                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                                />
                              </div>
                            </div>

                            {/* 响应报文 */}
                            <div className="log-section">
                              <div className="log-section-header">响应报文</div>
                              <div className="log-section-content">
                                <CodeMirror
                                  value={tryFormatJson(log.response_body)}
                                  height="auto"
                                  maxHeight="300px"
                                  extensions={[json()]}
                                  editable={false}
                                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                                />
                              </div>
                            </div>

                            {/* 参数提取 & 检查点校验 */}
                            <div className="log-section">
                              <div className="log-section-header">
                                提取和断言
                                {logAssertions.length > 0 && (
                                  <span className="log-assert-summary">
                                    ({logAssertions.filter(a => a.rule.assert !== false && a.passed).length}/{logAssertions.filter(a => a.rule.assert !== false).length} 通过)
                                  </span>
                                )}
                              </div>
                              <div className="log-section-content">
                                {logAssertions.length > 0 ? (
                                  <div className="ad-assertion-results">
                                    {logAssertions.map((ar, i) => (
                                      <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
                                        <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
                                        <div className="ad-ar-detail">
                                          {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
                                          <div className="ad-ar-row">
                                            <span className="ad-ar-label">提取:</span>
                                            <span>{srcLabel(ar.rule.source)}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span>
                                            <span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span>
                                            <span className="ad-ar-extract-val">{ar.actual}</span>
                                          </div>
                                          {ar.rule.assert !== false && (
                                            <div className="ad-ar-row">
                                              <span className="ad-ar-label">校验:</span>
                                              <span className="ad-ar-check-text">{opLabel(ar.rule.operator)} {ar.rule.expected || ''}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="ad-empty-hint">暂无数据</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <MessageModal open={modalOpen} message={modalMsg} type={modalType} onClose={() => setModalOpen(false)} />
    </div>
  );
}
