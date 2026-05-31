import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import './WebCaseDetail.css';

// ── Types ──
interface NLStep {
  action: string;
  desc: string;
}

interface Checkpoint {
  action: string;
  desc: string;
  passed: boolean;
}

interface EnvConfig {
  browser: string;
  windowSize: string;
  timeout: string;
  headless: boolean;
  baseUrl: string;
}

interface ExecRecord {
  id: number;
  time: string;
  status: 'success' | 'failed' | 'running';
  duration: string;
  executor: string;
  passRate: string;
}

// ── Constants ──
const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'precondition', label: '前置条件' },
  { key: 'steps', label: '测试步骤' },
  { key: 'checkpoints', label: '检查点' },
  { key: 'data', label: '数据驱动' },
  { key: 'env', label: '环境配置' },
  { key: 'logs', label: '执行记录' },
];

const PRECONDITION_TYPES = ['环境', '数据', '导航'];
const STEP_TYPES = ['打开页面', '输入', '点击', '勾选'];
const CHECKPOINT_TYPES = ['检查页面跳转', '检查文本', '检查元素'];

const BROWSER_OPTIONS = [
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'WebKit' },
];

const WINDOW_OPTIONS = [
  { value: '1920x1080', label: '1920 x 1080' },
  { value: '1366x768', label: '1366 x 768' },
  { value: '1280x720', label: '1280 x 720' },
  { value: '375x812', label: '375 x 812 (iPhone)' },
];

// ── Render: variable tokens ──
function renderDesc(desc: string) {
  const parts = desc.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{.+\}\}$/.test(part)) {
      return <span key={i} className="nl-var">{part}</span>;
    }
    return part;
  });
}

// ── Component ──
export default function WebCaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [saving, setSaving] = useState(false);


  const [activeTab, setActiveTab] = useState('detail');
  const [form, setForm] = useState({
    name: '',
    status: 'draft',
    description: '',
    tags: '',
    created_at: '',
    updated_at: '',
  });
  const dirtyRef = useRef(false);
  const originalFormRef = useRef({ ...form });

  // Track dirty state when form changes
  useEffect(() => {
    dirtyRef.current = form.name !== originalFormRef.current.name ||
      form.description !== originalFormRef.current.description ||
      form.tags !== originalFormRef.current.tags ||
      form.status !== originalFormRef.current.status;
  }, [form]);

  const [preconditions, setPreconditions] = useState<NLStep[]>([]);
  const [steps, setSteps] = useState<NLStep[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [editingPrecondIdx, setEditingPrecondIdx] = useState<number | null>(null);
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [editingCheckIdx, setEditingCheckIdx] = useState<number | null>(null);

  const [dataHeaders, setDataHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [dataEnabled, setDataEnabled] = useState<boolean[]>([]);

  const [envConfig, setEnvConfig] = useState<EnvConfig>({
    browser: 'chromium',
    windowSize: '1920x1080',
    timeout: '30',
    headless: true,
    baseUrl: '',
  });

  const [execRecords, setExecRecords] = useState<ExecRecord[]>([]);

  // Load existing case from API
  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    apiFetch<any>(`/web-cases/${id}`)
      .then(res => {
        if (res.code === 200 && res.data) {
          const d = res.data;
          setForm({
            name: d.name || '',
            status: d.status || 'draft',
            description: d.description || '',
            tags: d.tags || '',
            created_at: d.created_at || '',
            updated_at: d.updated_at || '',
          });
          originalFormRef.current = {
            name: d.name || '',
            status: d.status || 'draft',
            description: d.description || '',
            tags: d.tags || '',
          };
          dirtyRef.current = false;
          try { setSteps(d.steps ? JSON.parse(d.steps) : []); } catch { setSteps([]); }
          try { setCheckpoints(d.check_points ? JSON.parse(d.check_points) : []); } catch { setCheckpoints([]); }
          try {
            const dd = JSON.parse(d.data_drive || '{}');
            setDataHeaders(dd.headers || []);
            setDataRows(dd.rows || []);
            setDataEnabled(dd.enabled || []);
          } catch {
            setDataHeaders([]); setDataRows([]); setDataEnabled([]);
          }
          if (d.preconditions) {
            try { setPreconditions(JSON.parse(d.preconditions)); } catch { setPreconditions([]); }
          }
          setEnvConfig({
            browser: d.browser || 'chromium',
            windowSize: d.window_size || '1920x1080',
            timeout: String(d.timeout || '30'),
            headless: d.headless_mode === 1 || d.headless_mode === true,
            baseUrl: d.base_url || '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // Load execution logs
  useEffect(() => {
    if (isNew || !id) return;
    apiFetch<any>(`/web-cases/${id}/logs?limit=10`).then(res => {
      if (res.code === 200 && res.data) {
        setExecRecords(res.data.map((log: any) => ({
          id: log.id,
          time: formatDateTime(log.executed_at),
          status: log.status as 'success' | 'failed' | 'running',
          duration: log.duration_ms ? `${log.duration_ms}ms` : '-',
          executor: log.executed_by || '-',
          passRate: '-',
        })));
      }
    });
  }, [id, isNew]);



  const handleExecute = async () => {
    if (!id || isNew) { notification.error('请先保存用例'); return; }
    setExecuting(true);
    try {
      const res = await apiFetch(`/web-cases/${id}/execute`, { method: 'POST' });
      if (res.code === 200) {
        notification.success('执行完成');
        const logsRes = await apiFetch<any>(`/web-cases/${id}/logs?limit=10`);
        if (logsRes.code === 200 && logsRes.data) {
          setExecRecords(logsRes.data.map((log: any) => ({
            id: log.id,
            time: formatDateTime(log.executed_at),
            status: log.status as 'success' | 'failed' | 'running',
            duration: log.duration_ms ? `${log.duration_ms}ms` : '-',
            executor: log.executed_by || '-',
            passRate: '-',
          })));
          setActiveTab('logs');
        }
      } else {
        notification.error('执行失败');
      }
    } catch {
      notification.error('执行出错');
    } finally {
      setExecuting(false);
    }
  };

  const handleSave = () => {
    const payload: any = {
      name: form.name,
      description: form.description,
      tags: form.tags,
      status: form.status,
      test_type: 'web',
      steps: JSON.stringify(steps),
      check_points: JSON.stringify(checkpoints),
      data_drive: JSON.stringify({ headers: dataHeaders, rows: dataRows, enabled: dataEnabled }),
      preconditions: JSON.stringify(preconditions),
      browser: envConfig.browser,
      window_size: envConfig.windowSize,
      timeout: Number(envConfig.timeout) || 30,
      headless_mode: envConfig.headless ? 1 : 0,
      base_url: envConfig.baseUrl,
    };
    const method = isNew ? 'POST' : 'PUT';
    const path = isNew ? '/web-cases' : `/web-cases/${id}`;
    setSaving(true);
    apiFetch(path, { method, body: JSON.stringify(payload) })
      .then(res => {
        if (res.code === 200 || res.code === 201) {
          notification.success('保存成功');
          originalFormRef.current = { ...form };
          dirtyRef.current = false;
          if (isNew && res.data?.id) {
            setTimeout(() => navigate(`/web-test/case/${res.data.id}`, { replace: true }), 500);
          }
        } else {
          notification.error(res.message || '保存失败');
        }
      })
      .catch(() => notification.error('保存失败'))
      .finally(() => setSaving(false));
  };

  // -- Data drive helpers --
  const toggleDataRow = (idx: number) => {
    setDataEnabled(prev => { const next = [...prev]; next[idx] = !next[idx]; return next; });
  };
  const toggleAllData = (checked: boolean) => {
    setDataEnabled(dataRows.map(() => checked));
  };
  const setDataCell = (row: number, col: number, val: string) => {
    setDataRows(prev => prev.map((r, ri) => ri === row ? r.map((c, ci) => ci === col ? val : c) : r));
  };
  const addDataRow = () => {
    setDataRows(prev => [...prev, new Array(dataHeaders.length).fill('')]);
    setDataEnabled(prev => [...prev, true]);
  };
  const addDataCol = () => {
    const newCol = prompt('请输入新列名：');
    if (!newCol) return;
    setDataHeaders(prev => [...prev, newCol]);
    setDataRows(prev => prev.map(r => [...r, '']));
  };
  const removeDataCol = (idx: number) => {
    setDataHeaders(prev => prev.filter((_, i) => i !== idx));
    setDataRows(prev => prev.map(r => r.filter((_, i) => i !== idx)));
  };
  const removeDataRow = (idx: number) => {
    setDataRows(prev => prev.filter((_, i) => i !== idx));
    setDataEnabled(prev => prev.filter((_, i) => i !== idx));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split('\n');
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => line.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      setDataHeaders(headers);
      setDataRows(rows);
      setDataEnabled(rows.map(() => true));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const csv = [dataHeaders.join(','), ...dataRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'web-test-data.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Tab Renderers ──

  const renderDetailTab = () => (
    <div className="tab-content-wrapper tab-detail-wrapper">
      <div className="ad-section ad-section-fill">
        <div className="api-detail-row">
          <div className="field">
            <label>用例名称</label>
            <InlineText value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="点击输入用例名称" />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>描述</label>
            <InlineText value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="点击输入描述" multiline />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>标签</label>
            <TagInput value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="点击选择标签" />
          </div>
          <div className="field">
            <label>状态</label>
            <InlineSelect
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={v => setForm(f => ({ ...f, status: v }))}
              renderDisplay={(v, label) => <span className={`status-text status-${v}`}>{label}</span>}
            />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>创建时间</label>
            <span className="field-value">{form.created_at}</span>
          </div>
          <div className="field">
            <label>更新时间</label>
            <span className="field-value">{form.updated_at}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPreconditionTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>前置条件</label>
        </div>
        <div className="nl-steps">
          {preconditions.map((step, i) => (
            <div key={i} className="nl-step">
              <div className="nl-step-num">{i + 1}</div>
              <div className="nl-step-body">
                {editingPrecondIdx === i ? (
                  <>
                    <select className="nl-step-action-select" value={step.action} onChange={e => { const updated = [...preconditions]; updated[i] = { ...updated[i], action: e.target.value }; setPreconditions(updated); }}>
                      {PRECONDITION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="nl-step-desc-input" value={step.desc} onChange={e => { const updated = [...preconditions]; updated[i] = { ...updated[i], desc: e.target.value }; setPreconditions(updated); }} />
                    <button className="rule-save" onClick={() => setEditingPrecondIdx(null)}>✓</button>
                  </>
                ) : (
                  <>
                    <div className="nl-step-action">{step.action}</div>
                    <div className="nl-step-desc">{renderDesc(step.desc)}</div>
                    <button className="rule-edit" onClick={() => setEditingPrecondIdx(i)}>编辑</button>
                  </>
                )}
              </div>
              <button className="rule-del" onClick={() => setPreconditions(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div
          className="nl-step-add"
          onClick={() => setPreconditions(prev => [...prev, { action: '环境', desc: '' }])}
        >
          + 添加条件
        </div>
      </div>
    </div>
  );

  const renderStepsTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>测试步骤</label>
        </div>
        <div className="nl-steps">
          {steps.map((step, i) => (
            <div key={i} className="nl-step">
              <div className="nl-step-num">{i + 1}</div>
              <div className="nl-step-body">
                {editingStepIdx === i ? (
                  <>
                    <select className="nl-step-action-select" value={step.action} onChange={e => { const updated = [...steps]; updated[i] = { ...updated[i], action: e.target.value }; setSteps(updated); }}>
                      {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="nl-step-desc-input" value={step.desc} onChange={e => { const updated = [...steps]; updated[i] = { ...updated[i], desc: e.target.value }; setSteps(updated); }} />
                    <button className="rule-save" onClick={() => setEditingStepIdx(null)}>✓</button>
                  </>
                ) : (
                  <>
                    <div className="nl-step-action">{step.action}</div>
                    <div className="nl-step-desc">{renderDesc(step.desc)}</div>
                    <button className="rule-edit" onClick={() => setEditingStepIdx(i)}>编辑</button>
                  </>
                )}
              </div>
              <button className="rule-del" onClick={() => setSteps(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div
          className="nl-step-add"
          onClick={() => setSteps(prev => [...prev, { action: '点击', desc: '' }])}
        >
          + 添加步骤
        </div>
      </div>
    </div>
  );

  const renderCheckpointsTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>检查点</label>
        </div>
        <div className="nl-steps">
          {checkpoints.map((cp, i) => (
            <div key={i} className="nl-step">
              {editingCheckIdx === i ? (
                <>
                  <select className="nl-step-action-select" value={cp.action} onChange={e => { const updated = [...checkpoints]; updated[i] = { ...updated[i], action: e.target.value }; setCheckpoints(updated); }}>
                    {CHECKPOINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input className="nl-step-desc-input" value={cp.desc} onChange={e => { const updated = [...checkpoints]; updated[i] = { ...updated[i], desc: e.target.value }; setCheckpoints(updated); }} />
                  <button className="rule-save" onClick={() => setEditingCheckIdx(null)}>✓</button>
                </>
              ) : (
                <>
                  <div className={`nl-step-num ${cp.passed ? 'nl-step-num-passed' : 'nl-step-num-failed'}`}>
                    {cp.passed ? '✓' : '✗'}
                  </div>
                  <div className="nl-step-body">
                    <div className="nl-step-action">{cp.action}</div>
                    <div className="nl-step-desc">{renderDesc(cp.desc)}</div>
                    <button className="rule-edit" onClick={() => setEditingCheckIdx(i)}>编辑</button>
                  </div>
                </>
              )}
              <button className="rule-del" onClick={() => setCheckpoints(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div
          className="nl-step-add"
          onClick={() => setCheckpoints(prev => [...prev, { action: '检查文本', desc: '', passed: false }])}
        >
          + 添加检查点
        </div>
      </div>
    </div>
  );

  const renderDataTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>数据驱动</label>
        </div>
        <div className="param-action-row">
          <label className="param-upload-btn">
            <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileUpload} />
            上传 CSV
          </label>
          <button className="ad-btn ad-btn-sm" onClick={downloadTemplate}>下载数据</button>
          <button className="ad-btn ad-btn-sm" onClick={addDataRow}>添加行</button>
          <button className="ad-btn ad-btn-sm" onClick={addDataCol}>添加列</button>
        </div>
        <div className="param-table-wrapper">
          <table className="param-table">
            <thead>
              <tr>
                <th className="param-th-check">
                  {dataRows.length > 0 && (
                    <input
                      type="checkbox"
                      checked={dataEnabled.every(Boolean)}
                      onChange={e => toggleAllData(e.target.checked)}
                    />
                  )}
                </th>
                <th className="param-th-del"></th>
                {dataHeaders.map((h, ci) => (
                  <th key={ci}>
                    <span>{h}</span>
                    <button className="param-col-del" onClick={() => removeDataCol(ci)} title="删除此列">✕</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className={dataEnabled[ri] ? '' : 'param-row-disabled'}>
                  <td>
                    <label className="param-row-check">
                      <input type="checkbox" checked={dataEnabled[ri]} onChange={() => toggleDataRow(ri)} />
                    </label>
                  </td>
                  <td>
                    <button className="param-row-del" onClick={() => removeDataRow(ri)} title="删除此行">✕</button>
                  </td>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <input
                        className="param-cell-input"
                        value={cell}
                        onChange={e => setDataCell(ri, ci, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="param-usage-hint">
          <div className="param-usage-title">使用方式：</div>
          <div>在步骤描述中使用 <code>{'{{变量名}}'}</code> 引用数据列</div>
          <div>例如：<code>{'{{手机号}}'}</code> 会替换为当前行对应列的值</div>
        </div>
      </div>
    </div>
  );

  const renderEnvTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>环境配置</label>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>浏览器</label>
            <select
              value={envConfig.browser}
              onChange={e => setEnvConfig(c => ({ ...c, browser: e.target.value }))}
            >
              {BROWSER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>窗口大小</label>
            <select
              value={envConfig.windowSize}
              onChange={e => setEnvConfig(c => ({ ...c, windowSize: e.target.value }))}
            >
              {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>超时时间（秒）</label>
            <input
              type="number"
              min={1}
              value={envConfig.timeout}
              onChange={e => setEnvConfig(c => ({ ...c, timeout: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>无头模式</label>
            <div className="web-env-headless">
              <label className="rule-switch">
                <input
                  type="checkbox"
                  checked={envConfig.headless}
                  onChange={() => setEnvConfig(c => ({ ...c, headless: !c.headless }))}
                />
                <span className="rule-switch-slider">
                  <span className="rule-switch-label">{envConfig.headless ? '开启' : '关闭'}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>基础 URL</label>
            <input
              type="text"
              value={envConfig.baseUrl}
              onChange={e => setEnvConfig(c => ({ ...c, baseUrl: e.target.value }))}
              placeholder="https://example.com"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderLogsTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>执行记录</label>
        </div>
        {execRecords.length === 0 ? (
          <div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th>执行时间</th>
                <th>状态</th>
                <th>耗时</th>
                <th>执行人</th>
                <th>检查点通过率</th>
              </tr>
            </thead>
            <tbody>
              {execRecords.map(rec => (
                <tr key={rec.id}>
                  <td>{rec.time}</td>
                  <td>
                    <span className={`status-badge web-status-${rec.status}`}>
                      {rec.status === 'success' ? '通过' : rec.status === 'failed' ? '失败' : '执行中'}
                    </span>
                  </td>
                  <td>{rec.duration}</td>
                  <td>{rec.executor}</td>
                  <td>
                    <span className={rec.passRate.startsWith('3') ? 'assert-pass' : 'assert-fail'}>
                      {rec.passRate}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="web-case-detail">
      <div className="api-detail-header">
        <button className="api-detail-back" onClick={() => navigate('/web-test')}>← 返回列表</button>
        <span className="api-detail-page-title">{form.name || '新建 Web 用例'}</span>
        <span className={`status-badge web-status-badge status-${form.status}`}>
          {STATUS_OPTIONS.find(o => o.value === form.status)?.label || form.status}
        </span>
      </div>
      <div className="api-detail-content">
        <div className="api-detail-card" style={{ padding: 0 }}>
          <div className="tab-nav">
            {TABS.map(tab => (
              <button
                key={tab.key}
                className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'precondition' && renderPreconditionTab()}
            {activeTab === 'steps' && renderStepsTab()}
            {activeTab === 'checkpoints' && renderCheckpointsTab()}
            {activeTab === 'data' && renderDataTab()}
            {activeTab === 'env' && renderEnvTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
          {activeTab !== 'logs' && (
            <div className="detail-action-bar">
              <button className={`wcase-btn ${dirtyRef.current ? 'dirty' : ''}`} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
              <button className="wcase-btn primary" onClick={handleExecute} disabled={executing || isNew}>
                {executing ? '执行中...' : '执行'}
              </button>
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
