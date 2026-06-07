import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import LogTab, { type ExecRecord } from '../../components/tabs/LogTab';
import { CaseContentEditor, type CaseContentType } from '../../components/CaseContentEditor';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { NLStep } from '../../types';
import './PcCaseDetail.css';

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
  driverPath: string;
  closeBrowserAfterExecution: boolean;
}

// ── Constants ──
const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'precondition', label: '前置动作' },
  { key: 'content', label: '用例内容' },
  { key: 'checkpoints', label: '检查点' },
  { key: 'data', label: '数据驱动' },
  { key: 'env', label: '环境配置' },
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
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari', label: 'Safari' },
  { value: 'edge', label: 'Edge' },
];

const WINDOW_OPTIONS = [
  { value: '1920x1080', label: '1920 x 1080' },
  { value: '1366x768', label: '1366 x 768' },
  { value: '1280x720', label: '1280 x 720' },
  { value: '1440x900', label: '1440 x 900' },
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
export default function PcCaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);


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
  // and JSON-encode them in the dirty effect for cheap deep comparison.
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
    browser: 'chrome',
    windowSize: '1920x1080',
    timeout: '30',
    headless: true,
    baseUrl: '',
    driverPath: '',
    closeBrowserAfterExecution: false,
  });

  const [execRecords, setExecRecords] = useState<ExecRecord[]>([]);
  const [latestReportUrl, setLatestReportUrl] = useState<string | null>(null);

  // Compute dirty by JSON-encoding every relevant field. Compared to the
  // original snapshot taken at load time (or right after a successful save).
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
    apiFetch<any>(`/pc-cases/${id}`)
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
          // Normalize old persisted checkpoints: strip any stale `passed`
          // (re-derived from latest execution on the next effect tick).
          try {
            const parsed = d.check_points ? (JSON.parse(d.check_points) as Checkpoint[]) : [];
            setCheckpoints(parsed.map(({ passed: _p, ...rest }) => rest));
          } catch { setCheckpoints([]); }
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
            browser: d.browser || 'chrome',
            windowSize: d.window_size || '1920x1080',
            timeout: String(d.timeout || '30'),
            headless: d.headless_mode === 1 || d.headless_mode === true,
            baseUrl: d.base_url || '',
            driverPath: d.driver_path || '',
            closeBrowserAfterExecution: d.close_browser_after_execution === 1 || d.close_browser_after_execution === true,
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
                browser: d.browser || 'chrome',
                windowSize: d.window_size || '1920x1080',
                timeout: String(d.timeout || '30'),
                headless: d.headless_mode === 1 || d.headless_mode === true,
                baseUrl: d.base_url || '',
                driverPath: d.driver_path || '',
                closeBrowserAfterExecution: d.close_browser_after_execution === 1 || d.close_browser_after_execution === true,
              },
            });
            setDirty(false);
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // Load execution logs
  useEffect(() => {
    if (isNew || !id) return;
    apiFetch<any>(`/pc-cases/${id}/logs?limit=10`).then(res => {
      if (res.code === 200 && res.data) {
        setExecRecords(res.data.map((log: any) => ({
          id: log.id,
          time: formatDateTime(log.executed_at),
          status: log.status as 'success' | 'failed' | 'running',
          duration: log.duration_ms ? `${log.duration_ms}ms` : '-',
          executor: log.executed_by || '-',
          passRate: log.result ? (() => {
            try {
              const r = JSON.parse(log.result);
              const total = r.steps?.length || 0;
              const passed = r.steps?.filter((s: any) => s.status === 'success').length || 0;
              return total > 0 ? `${Math.round((passed / total) * 100)}%` : '-';
            } catch { return '-'; }
          })() : '-',
        })));
      }
    });
  }, [id, isNew]);

  // Phase 5: load latest execution with a Midscene report (if any)
  useEffect(() => {
    if (isNew || !id) return;
    apiFetch<any>(`/pc-cases/${id}/executions?limit=1`).then(res => {
      if (res.code === 200 && res.data && res.data.length > 0) {
        const exec = res.data[0];
        setLatestReportUrl(exec.report_url || null);
        // Fill `passed` on each checkpoint by index from latest execution
        const result = typeof exec.result === 'string'
          ? (() => { try { return JSON.parse(exec.result); } catch { return null; } })()
          : exec.result;
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
  }, [id, isNew, execRecords.length]);



  const handleExecute = async () => {
    if (!id || isNew) { notification.error('请先保存用例'); return; }
    setExecuting(true);
    try {
      const res = await apiFetch(`/pc-cases/${id}/execute`, { method: 'POST' });
      if (res.code === 200) {
        notification.success('执行完成');
        // Reload logs
        const logsRes = await apiFetch<any>(`/pc-cases/${id}/logs?limit=10`);
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
      driver_path: envConfig.driverPath,
      close_browser_after_execution: envConfig.closeBrowserAfterExecution ? 1 : 0,
    };
    const method = isNew ? 'POST' : 'PUT';
    const path = isNew ? '/pc-cases' : `/pc-cases/${id}`;
    apiFetch<{ id: number }>(path, { method, body: JSON.stringify(payload) })
      .then(res => {
        if (res.code === 200 || res.code === 201) {
          // Refresh snapshot to the just-saved state so the save button
          // stops pulsing.
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
          if (isNew && res.data?.id) navigate(`/pc-test/case/${res.data.id}`, { replace: true });
        }
      });
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
    a.href = url; a.download = 'pc-test-data.csv'; a.click();
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
          <label>前置动作(自然语言描述,执行用例前由 Midscene aiAct 执行)</label>
        </div>
        <textarea
          className="nl-precondition-textarea"
          value={preconditions}
          onChange={e => setPreconditions(e.target.value)}
          placeholder="例:打开应用,确认未登录状态"
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
                  <th key={ci}>{h}</th>
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
          <div>在用例内容中使用 <code>{'{{变量名}}'}</code> 引用数据列</div>
          <div>例如：<code>{'{{用户名}}'}</code> 会替换为当前行对应列的值</div>
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
          <div className="field">
            <label>驱动路径（可选）</label>
            <input
              type="text"
              value={envConfig.driverPath}
              onChange={e => setEnvConfig(c => ({ ...c, driverPath: e.target.value }))}
              placeholder="留空使用项目自带驱动；填绝对路径则用指定驱动"
            />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>执行后关闭浏览器</label>
            <div className="web-env-headless">
              <label className="rule-switch" title="关闭后本 case 执行完销毁共享浏览器;关闭后下一个 case 会重新启动。默认关闭=复用浏览器,加速连续执行。">
                <input
                  type="checkbox"
                  checked={envConfig.closeBrowserAfterExecution}
                  onChange={() => setEnvConfig(c => ({ ...c, closeBrowserAfterExecution: !c.closeBrowserAfterExecution }))}
                />
                <span className="rule-switch-slider">
                  <span className="rule-switch-label">{envConfig.closeBrowserAfterExecution ? '关闭' : '复用'}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLogsTab = () => (
    <LogTab latestReportUrl={latestReportUrl} execRecords={execRecords} />
  );

  return (
    <div className="web-case-detail">
      <div className="api-detail-header">
        <button className="api-detail-back" onClick={() => navigate('/pc-test/case')}>← 返回列表</button>
        <span className="api-detail-page-title">{form.name || '新建 PC 测试用例'}</span>
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
            {activeTab === 'content' && renderCaseContentTab()}
            {activeTab === 'checkpoints' && renderCheckpointsTab()}
            {activeTab === 'data' && renderDataTab()}
            {activeTab === 'env' && renderEnvTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
          {activeTab !== 'logs' && (
            <div className="detail-action-bar">
              <button className={`scenario-btn ${dirty ? 'dirty' : ''}`} onClick={handleSave}>保存</button>
              <button className="sset-btn sset-btn-primary" onClick={handleExecute} disabled={executing || isNew}>
                {executing ? '执行中...' : '执行'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}