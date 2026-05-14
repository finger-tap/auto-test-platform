import { useState, useEffect, Fragment, useCallback, useRef, type FormEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { apiFetch } from '../../utils/api';
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

const defaultAssertion = (): AssertionRule => ({ source: 'status', key: '', operator: 'equals', expected: '' });

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
  const [api, setApi] = useState<ApiItem | null>(null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [editing, setEditing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ApiLog | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [error, setError] = useState('');
  const autoExecRef = useRef(false);

  const [form, setForm] = useState({
    name: '', method: 'GET', url: '', protocol: 'https',
    headers: '', body: '', description: '', tags: '', status: 'active',
    content_type: 'json', assertions: '[]',
  });

  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>([]);

  const handleExecute = async () => {
    setExecuting(true);
    setLastResult(null);
    setResultCollapsed(false);
    try {
      const res = await apiFetch<ApiLog>(`/apis/${id}/execute`, { method: 'POST' });
      if (res.code === 200 && res.data) {
        setLastResult(res.data);
        const logsRes = await apiFetch<ApiLog[]>(`/apis/${id}/logs`);
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setExecuting(false);
    }
  };

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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form, assertions: JSON.stringify(assertionRules) };
      const res = await apiFetch(`/apis/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      if (res.code !== 200) throw new Error(res.message);
      setEditing(false);
      setApi({ ...api!, ...payload, updated_at: new Date().toISOString() } as ApiItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
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

  const addRule = () => setAssertionRules([...assertionRules, defaultAssertion()]);
  const removeRule = (idx: number) => setAssertionRules(assertionRules.filter((_, i) => i !== idx));
  const updateRule = (idx: number, field: keyof AssertionRule, value: string) => {
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
            {!editing ? (
              <button className="ad-btn ad-btn-default" onClick={() => setEditing(true)}>编辑</button>
            ) : (
              <button type="button" className="ad-btn ad-btn-default" onClick={() => setEditing(false)}>取消</button>
            )}
            <button className="ad-btn ad-btn-primary" onClick={handleExecute} disabled={executing}>
              {executing ? '执行中...' : '执行'}
            </button>
          </div>
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
                <label>描述</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="接口描述（可选）" />
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

            {/* Content Type selector — own row */}
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

            {/* Assertion Rules */}
            <div className="ad-section">
              <div className="ad-section-head">
                <label>断言规则</label>
                <button type="button" className="ad-btn ad-btn-sm" onClick={addRule}>+ 添加规则</button>
              </div>
              {assertionRules.length === 0 && <div className="ad-empty-hint">暂无断言规则，点击"添加规则"</div>}
              {assertionRules.map((rule, idx) => (
                <div key={idx} className="ad-assertion-row">
                  <select value={rule.source} onChange={(e) => updateRule(idx, 'source', e.target.value)}>
                    {ASSERTION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <input
                    placeholder={rule.source === 'status' ? '(自动取状态码)' : rule.source === 'header' ? 'Header 名称' : '路径 如 data.id'}
                    value={rule.key}
                    onChange={(e) => updateRule(idx, 'key', e.target.value)}
                    style={{ width: rule.source === 'status' ? 100 : 140 }}
                    disabled={rule.source === 'status'}
                  />
                  <select value={rule.operator} onChange={(e) => updateRule(idx, 'operator', e.target.value)}>
                    {ASSERTION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {!['exists', 'not_exists'].includes(rule.operator) && (
                    <input placeholder="期望值" value={rule.expected} onChange={(e) => updateRule(idx, 'expected', e.target.value)} />
                  )}
                  <button type="button" className="ad-btn-del" onClick={() => removeRule(idx)}>✕</button>
                </div>
              ))}
            </div>

            <div className="api-detail-actions">
              <button type="submit" className="ad-btn ad-btn-primary">保存</button>
              <button type="button" className="ad-btn ad-btn-default" onClick={() => setEditing(false)}>取消</button>
            </div>
          </form>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="api-detail-row">
              <div className="field"><label>接口名称</label><div className="value">{api.name}</div></div>
              <div className="field"><label>方法</label><div className="value"><span className={`method-badge method-${api.method}`}>{api.method}</span></div></div>
              <div className="field"><label>协议</label><div className="value">{api.protocol}</div></div>
            </div>
            {api.description && (
              <div className="api-detail-row">
                <div className="field"><label>描述</label><div className="value">{api.description}</div></div>
              </div>
            )}
            <div className="api-detail-row">
              <div className="field"><label>请求地址</label><div className="value" style={{ fontFamily: 'monospace' }}>{api.url}</div></div>
            </div>
            <div className="api-detail-row">
              <div className="field"><label>标签</label><div className="value">{api.tags ? api.tags.split(',').filter(Boolean).map((t) => (
                <span key={t} className="ad-tag">{t.trim()}</span>
              )) : '-'}</div></div>
              <div className="field"><label>状态</label><div className="value"><span className={`status-text status-${api.status}`}>{api.status === 'active' ? '启用' : api.status === 'disabled' ? '禁用' : '草稿'}</span></div></div>
            </div>
            {api.headers && (
              <div className="ad-editor-section">
                <label>请求头</label>
                <CodeMirror
                  value={tryFormatJson(api.headers)}
                  height="auto"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
            )}
            {api.body && (
              <div className="ad-editor-section" style={{ marginTop: 12 }}>
                <label>请求体 ({contentTypeLabel(api.content_type)})</label>
                <CodeMirror
                  value={tryFormatJson(api.body)}
                  height="auto"
                  extensions={getEditorLang(api.content_type || 'json') || []}
                  editable={false}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
            )}
            {(() => {
              let rules: AssertionRule[] = [];
              try { rules = JSON.parse(api.assertions || '[]'); } catch { /* */ }
              if (rules.length === 0) return null;
              return (
                <div className="api-detail-row" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>断言规则</label>
                    <div className="ad-assertion-list">
                      {rules.map((r, i) => (
                        <span key={i} className="ad-assertion-tag">
                          {srcLabel(r.source)} {r.key && r.source !== 'status' ? `.${r.key}` : ''} {opLabel(r.operator)} {r.expected || ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
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
            <>
              {lastResult.assertion_results && lastResult.assertion_results.length > 0 && (
                <div className="ad-assertion-results">
                  <div className="ad-assertion-results-head">
                    断言结果 ({lastResult.assertion_results.filter(r => r.passed).length}/{lastResult.assertion_results.length} 通过)
                  </div>
                  {lastResult.assertion_results.map((ar, i) => (
                    <div key={i} className={`ad-assertion-result ${ar.passed ? 'pass' : 'fail'}`}>
                      <span className="ad-ar-icon">{ar.passed ? '✓' : '✗'}</span>
                      <span className="ad-ar-text">
                        {srcLabel(ar.rule.source)} {ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''} {opLabel(ar.rule.operator)} {ar.rule.expected || ''}
                      </span>
                      <span className="ad-ar-actual">实际值: {ar.actual}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="ad-editor-section" style={{ marginTop: 12 }}>
                <label>响应报文</label>
                <CodeMirror
                  value={tryFormatJson(lastResult.response_body)}
                  height="auto"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
            </>
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
                          {logAssertions.length > 0 && (
                            <div className="ad-assertion-results" style={{ marginBottom: 12 }}>
                              {logAssertions.map((ar, i) => (
                                <div key={i} className={`ad-assertion-result ${ar.passed ? 'pass' : 'fail'}`}>
                                  <span className="ad-ar-icon">{ar.passed ? '✓' : '✗'}</span>
                                  <span className="ad-ar-text">
                                    {srcLabel(ar.rule.source)} {ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''} {opLabel(ar.rule.operator)} {ar.rule.expected || ''}
                                  </span>
                                  <span className="ad-ar-actual">实际值: {ar.actual}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {log.response_body && (
                            <CodeMirror
                              value={tryFormatJson(log.response_body)}
                              height="auto"
                              maxHeight="300px"
                              extensions={[json()]}
                              editable={false}
                              basicSetup={{ lineNumbers: true, foldGutter: true }}
                            />
                          )}
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
    </div>
  );
}
