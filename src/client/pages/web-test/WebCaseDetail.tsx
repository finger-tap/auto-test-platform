import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import FormSelect from '../../components/FormSelect';
import DevicePickerModal from '../../components/DevicePickerModal';
import LogTab, { type ExecRecord } from '../../components/tabs/LogTab';
import { CaseContentEditor, type CaseContentType } from '../../components/CaseContentEditor';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { formatDateTime, formatDuration } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { NLStep } from '../../types';
import './WebCaseDetail.css';

// ── Types ──
interface Checkpoint extends NLStep {
  // UI-only: filled in from the latest execution record (by index), not
  // persisted on save. Default false for fresh cases.
  passed?: boolean;
}

interface EnvConfig {
  browser: string;
  windowSize: string;
  timeout: string;
  headless: boolean;
  baseUrl: string;
}

// ── Constants ──
const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'env', label: '环境配置' },
  { key: 'precondition', label: '前置动作' },
  { key: 'content', label: '用例内容' },
  { key: 'checkpoints', label: '检查点' },
  { key: 'data', label: '数据驱动' },
  { key: 'logs', label: '执行记录' },
];

// Legacy migration: convert the old NLStep[] shape to a flat natural-language
// string. New code stores case_content directly; this only fires for rows
// saved before the case_content column was introduced.
function nlStepsToText(steps: NLStep[]): string {
  return steps
    .map((s) => {
      const desc = s.description || '';
      const expect = s.expect ? `\n  期望: ${s.expect}` : '';
      return `- ${desc}${expect}`;
    })
    .join('\n');
}

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
  const { activeEnv } = useEnvironment();
  const isNew = !id || id === 'new';
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [saving, setSaving] = useState(false);
  // 2026-06-21: 统一设备选择弹窗。null = 本机执行。
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [selectedDeviceName, setSelectedDeviceName] = useState<string | null>(null);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);


  const [activeTab, setActiveTab] = useState('detail');
  const [form, setForm] = useState({
    name: '',
    status: 'draft',
    description: '',
    tags: '',
    created_at: '',
    updated_at: '',
  });
  // Snapshot of all relevant state captured at load time / last save.
  // Used to compute `dirty` — true when current state diverges from the snapshot.
  // We store the original values in a ref (no re-renders on snapshot update)
  // and a JSON-encoded form in a separate ref so the dirty effect can compare
  // arrays/objects cheaply.
  const originalSnapshotRef = useRef<string>('');
  const [dirty, setDirty] = useState(false);

  // Precondition: a single natural-language action handed to Midscene's
  // `aiAct` before the main case content runs. Old rows may store a JSON
  // NLStep[] (legacy assertion-shaped format) — the load effect flattens
  // those into a single text so existing rows display correctly.
  const [preconditions, setPreconditions] = useState<string>('');
  const [caseContent, setCaseContent] = useState('');
  const [caseContentType, setCaseContentType] = useState<CaseContentType>('text');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

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
  const [latestReportUrl, setLatestReportUrl] = useState<string | null>(null);

  // Compute dirty by JSON-encoding every relevant field. Compared to the
  // original snapshot taken at load time (or right after a successful save).
  // Re-runs whenever any tracked piece of state changes, so the breathing
  // save button lights up the moment the user touches anything.
  useEffect(() => {
    const current = JSON.stringify({
      form: { name: form.name, description: form.description, tags: form.tags, status: form.status },
      preconditions,
      caseContent,
      caseContentType,
      checkpoints: checkpoints.map(({ passed: _p, ...rest }) => rest),
      dataHeaders,
      dataRows,
      dataEnabled,
      envConfig,
    });
    setDirty(current !== originalSnapshotRef.current);
  }, [form, preconditions, caseContent, caseContentType, checkpoints, dataHeaders, dataRows, dataEnabled, envConfig]);

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
          try {
            if (d.case_content !== undefined && d.case_content !== null) {
              setCaseContent(d.case_content);
              setCaseContentType(d.case_content_type === 'yaml' ? 'yaml' : 'text');
            } else if (d.steps) {
              // Legacy row: convert NLStep[] into a flat text representation
              // so the new editor can still display it on first open.
              const legacy = JSON.parse(d.steps) as NLStep[];
              setCaseContent(nlStepsToText(legacy));
              setCaseContentType('text');
            } else {
              setCaseContent('');
              setCaseContentType('text');
            }
          } catch {
            setCaseContent('');
            setCaseContentType('text');
          }
          try { setCheckpoints(d.check_points ? JSON.parse(d.check_points) : []); } catch { setCheckpoints([]); }
          // Default `passed` from the most recent execution's checkpoint
          // results (server runs the case, returns result.checkpoints: bool[]).
          // The fetch below may not have completed yet, so we also re-apply
          // when execRecords lands. If the DB had a `passed` field embedded
          // from old saves, normalize it through the same fill-on-load path.
          if (d.check_points) {
            try {
              const parsed = JSON.parse(d.check_points) as Checkpoint[];
              setCheckpoints(parsed.map(({ passed: _p, ...rest }) => ({ ...rest, passed: undefined })));
            } catch { /* keep current */ }
          }
          try {
            const dd = JSON.parse(d.data_drive || '{}');
            setDataHeaders(dd.headers || []);
            setDataRows(dd.rows || []);
            setDataEnabled(dd.enabled || []);
          } catch {
            setDataHeaders([]); setDataRows([]); setDataEnabled([]);
          }
          if (d.preconditions) {
            // Backward compat: old rows may store a JSON NLStep[] from the
            // legacy assertion-shaped format. Flatten to plain text.
            const trimmed = d.preconditions.trimStart();
            if (trimmed.startsWith('[')) {
              try {
                const legacy = JSON.parse(d.preconditions) as NLStep[];
                setPreconditions(legacy.map(s => s.expect ? `${s.description}\n期望: ${s.expect}` : s.description).filter(Boolean).join('\n'));
              } catch { setPreconditions(d.preconditions); }
            } else {
              setPreconditions(d.preconditions);
            }
          }
          setEnvConfig({
            browser: d.browser || 'chromium',
            windowSize: d.window_size || '1920x1080',
            timeout: String(d.timeout || '30'),
            headless: d.headless_mode === 1 || d.headless_mode === true,
            baseUrl: d.base_url || '',
          });
          // Capture the original snapshot after the synchronous state setters
          // have flushed. We rebuild it from the same keys the dirty effect
          // uses so first-render dirty === false.
          queueMicrotask(() => {
            originalSnapshotRef.current = JSON.stringify({
              form: { name: d.name || '', description: d.description || '', tags: d.tags || '', status: d.status || 'draft' },
              preconditions: d.preconditions ? (() => {
                const t = d.preconditions.trimStart();
                if (!t.startsWith('[')) return d.preconditions;
                try {
                  const legacy = JSON.parse(d.preconditions) as NLStep[];
                  return legacy.map(s => s.expect ? `${s.description}\n期望: ${s.expect}` : s.description).filter(Boolean).join('\n');
                } catch { return d.preconditions; }
              })() : '',
              caseContent: (d.case_content !== undefined && d.case_content !== null)
                ? d.case_content
                : (d.steps ? nlStepsToText(JSON.parse(d.steps) as NLStep[]) : ''),
              caseContentType: d.case_content_type === 'yaml' ? 'yaml' : 'text',
              checkpoints: d.check_points ? (() => { try { return JSON.parse(d.check_points).map(({ passed: _p, ...rest }: any) => rest); } catch { return []; } })() : [],
              dataHeaders: (() => { try { return JSON.parse(d.data_drive || '{}').headers || []; } catch { return []; } })(),
              dataRows: (() => { try { return JSON.parse(d.data_drive || '{}').rows || []; } catch { return []; } })(),
              dataEnabled: (() => { try { return JSON.parse(d.data_drive || '{}').enabled || []; } catch { return []; } })(),
              envConfig: {
                browser: d.browser || 'chromium',
                windowSize: d.window_size || '1920x1080',
                timeout: String(d.timeout || '30'),
                headless: d.headless_mode === 1 || d.headless_mode === true,
                baseUrl: d.base_url || '',
              },
            });
            setDirty(false);
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // Load executions (has report_url) and build execRecords from them
  useEffect(() => {
    if (isNew || !id) return;
    apiFetch<any>(`/web-cases/${id}/executions?limit=20`).then(res => {
      if (res.code === 200 && res.data && res.data.length > 0) {
        const execs = res.data;
        setExecRecords(execs.map((e: any) => ({
          id: e.id,
          time: formatDateTime(e.started_at),
          status: (e.status === 'success' || e.status === 'failed' || e.status === 'error') ? e.status : 'running',
          duration: formatDuration(e.duration_ms),
          executor: '-',
          passRate: '-',
          reportUrl: e.report_url,
          errorMessage: e.error_message,
        })));
        const latest = execs[0];
        setLatestReportUrl(latest.report_url || null);
        // Fill `passed` on each checkpoint by index from latest execution
        const result = typeof latest.result === 'string'
          ? (() => { try { return JSON.parse(latest.result); } catch { return null; } })()
          : latest.result;
        const flags: unknown = result && typeof result === 'object' ? (result as any).checkpoints : null;
        if (Array.isArray(flags)) {
          setCheckpoints(prev => prev.map((cp, i) => ({
            ...cp,
            passed: Boolean((flags as unknown[])[i]),
          })));
        }
      } else {
        setLatestReportUrl(null);
      }
    }).catch(() => setLatestReportUrl(null));
  }, [id, isNew]);

  const handleExecute = async () => {
    if (!id || isNew) { notification.error('请先保存用例'); return; }
    setExecuting(true);
    try {
      const qs = new URLSearchParams();
      if (selectedDeviceId != null) qs.set('deviceId', String(selectedDeviceId));
      const url = `/web-cases/${id}/execute${qs.toString() ? '?' + qs : ''}`;
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({ environmentId: activeEnv?.id }),
      });
      if (res.code === 200) {
        notification.success('执行完成');
        const execRes = await apiFetch<any>(`/web-cases/${id}/executions?limit=20`);
        if (execRes.code === 200 && execRes.data) {
          setExecRecords(execRes.data.map((e: any) => ({
            id: e.id,
            time: formatDateTime(e.started_at),
            status: (e.status === 'success' || e.status === 'failed' || e.status === 'error') ? e.status : 'running',
            duration: formatDuration(e.duration_ms),
            executor: '-',
            passRate: '-',
            reportUrl: e.report_url,
            errorMessage: e.error_message,
          })));
          if (execRes.data[0]?.report_url) setLatestReportUrl(execRes.data[0].report_url);
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
    // Strip the UI-only `passed` flag from each checkpoint before save.
    // It is re-derived from the latest execution result on every load.
    const checkpointsForSave = checkpoints.map(({ passed: _p, ...rest }) => rest);
    const payload: any = {
      name: form.name,
      description: form.description,
      tags: form.tags,
      status: form.status,
      case_content: caseContent,
      case_content_type: caseContentType,
      check_points: JSON.stringify(checkpointsForSave),
      data_drive: JSON.stringify({ headers: dataHeaders, rows: dataRows, enabled: dataEnabled }),
      preconditions,
      browser: envConfig.browser,
      window_size: envConfig.windowSize,
      timeout: Number(envConfig.timeout) || 30,
      headless_mode: envConfig.headless ? 1 : 0,
      base_url: envConfig.baseUrl,
    };
    const method = isNew ? 'POST' : 'PUT';
    const path = isNew ? '/web-cases' : `/web-cases/${id}`;
    setSaving(true);
    apiFetch<{ id: number }>(path, { method, body: JSON.stringify(payload) })
      .then(res => {
        if (res.code === 200 || res.code === 201) {
          notification.success('保存成功');
          // Refresh the snapshot to the just-saved state so the save button
          // stops pulsing. Form timestamps may shift on the server, so we
          // preserve the user's edits verbatim.
          originalSnapshotRef.current = JSON.stringify({
            form: { name: form.name, description: form.description, tags: form.tags, status: form.status },
            preconditions,
            caseContent,
            caseContentType,
            checkpoints: checkpointsForSave,
            dataHeaders,
            dataRows,
            dataEnabled,
            envConfig,
          });
          setDirty(false);
          if (isNew && res.data?.id) {
            const newId = res.data.id;
            setTimeout(() => navigate(`/web-test/case/${newId}`, { replace: true }), 500);
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
    <div className="tab-content-wrapper">
      <div className="ad-section">
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
          <label>前置动作(自然语言描述,执行用例前由 Midscene aiAct 执行)</label>
        </div>
        <textarea
          className="nl-precondition-textarea"
          value={preconditions}
          onChange={e => setPreconditions(e.target.value)}
          placeholder="例:打开 /login 页面,确认未登录状态,然后返回首页"
          rows={8}
        />
        <div className="nl-precondition-hint">
          留空则不执行前置动作。整段文本会原样交给 Midscene 的 aiAct()。
        </div>
      </div>
    </div>
  );

  const renderCaseContentTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <CaseContentEditor
          value={caseContent}
          type={caseContentType}
          onChange={setCaseContent}
          onTypeChange={setCaseContentType}
        />
      </div>
    </div>
  );

  const renderCheckpointsTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>检查点(断言:执行后校验预期结果)</label>
        </div>
        <div className="nl-steps">
          {checkpoints.map((cp, i) => (
            <div key={i} className="nl-step nl-step-nl">
              <div className={`nl-step-num ${cp.passed === true ? 'nl-step-num-passed' : cp.passed === false ? 'nl-step-num-failed' : ''}`}>
                {cp.passed === true ? '✓' : cp.passed === false ? '✗' : '·'}
              </div>
              <div className="nl-step-body">
                <input
                  className="nl-step-desc-input"
                  value={cp.expect || ''}
                  onChange={e => { const u = [...checkpoints]; u[i] = { ...u[i], expect: e.target.value, description: '' }; setCheckpoints(u); }}
                  placeholder="例:页面跳转至 /home,顶部显示用户名"
                />
              </div>
              <button className="rule-del" onClick={() => setCheckpoints(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div className="nl-step-add" onClick={() => setCheckpoints(prev => [...prev, { description: '', expect: '' }])}>
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
                {dataHeaders.map((h, ci) => (
                  <th key={ci}>
                    <span>{h}</span>
                    <button className="param-col-del" onClick={() => removeDataCol(ci)} title="删除此列">✕</button>
                  </th>
                ))}
                <th className="param-th-del"></th>
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
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <input
                        className="param-cell-input"
                        value={cell}
                        onChange={e => setDataCell(ri, ci, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button className="param-row-del" onClick={() => removeDataRow(ri)} title="删除此行">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="param-usage-hint">
          <div className="param-usage-title">使用方式：</div>
          <div>在用例内容中使用 <code>{'{{变量名}}'}</code> 引用数据列</div>
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
            <FormSelect
              value={envConfig.browser}
              options={BROWSER_OPTIONS}
              onChange={v => setEnvConfig(c => ({ ...c, browser: v }))}
            />
          </div>
          <div className="field">
            <label>窗口大小</label>
            <FormSelect
              value={envConfig.windowSize}
              options={WINDOW_OPTIONS}
              onChange={v => setEnvConfig(c => ({ ...c, windowSize: v }))}
            />
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
              <label className="rule-switch rule-switch--labeled">
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
        <div className="wbc-env-hint">
          驱动路径、用户数据目录、下载目录、自动下载等浏览器行为已迁移到
          <a onClick={() => navigate('/web-test/browser-config')} className="wbc-env-link">「浏览器配置」</a>
          页面统一管理,影响本用户所有 Web 用例。
        </div>
      </div>
    </div>
  );

  const renderLogsTab = () => (
    <LogTab latestReportUrl={latestReportUrl} execRecords={execRecords} />
  );

  return (
    <div className="api-detail page-enter">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate('/web-test/case')}>用例列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input
            className="api-detail-name-input"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="新建 Web 用例"
          />
        </div>
        <div className="api-detail-meta">
          {!isNew && (
            <span className={`status-badge-light ${form.status}`}>
              {STATUS_OPTIONS.find(o => o.value === form.status)?.label || form.status}
            </span>
          )}
          {form.updated_at && (
            <span className="meta-time">更新于 {formatDateTime(form.updated_at)}</span>
          )}
        </div>
        <div className="api-detail-actions">
          <button
            type="button"
            className="scenario-btn"
            onClick={() => setDevicePickerOpen(true)}
            disabled={executing}
            title="选择执行设备"
          >
            {selectedDeviceName || '本机'}
          </button>
          <button className={`scenario-btn ${dirty ? 'dirty' : ''}`} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          <button className="sset-btn sset-btn-primary" onClick={handleExecute} disabled={executing || isNew}>
            {executing ? '执行中...' : '执行'}
          </button>
        </div>
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
            {activeTab === 'env' && renderEnvTab()}
            {activeTab === 'precondition' && renderPreconditionTab()}
            {activeTab === 'content' && renderCaseContentTab()}
            {activeTab === 'checkpoints' && renderCheckpointsTab()}
            {activeTab === 'data' && renderDataTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
        </div>
      </div>
      <DevicePickerModal
        open={devicePickerOpen}
        testType="web"
        onClose={() => setDevicePickerOpen(false)}
        onLocalExecute={() => {
          setSelectedDeviceId(null);
          setSelectedDeviceName(null);
          setDevicePickerOpen(false);
        }}
        onSelect={(device) => {
          setSelectedDeviceId(device.id as number);
          setSelectedDeviceName(device.name);
          setDevicePickerOpen(false);
        }}
      />
    </div>
  );
}
