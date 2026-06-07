import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import MidsceneReportViewer from '../../components/MidsceneReportViewer';
import { CaseContentEditor, type CaseContentType } from '../../components/CaseContentEditor';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { MobileTestCase, MobileTestLog, AssertionRule } from '../../types';
import './MobileTestDetail.css';

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'precondition', label: '前置动作' },
  { key: 'device', label: '设备配置' },
  { key: 'app', label: '应用配置' },
  { key: 'content', label: '用例内容' },
  { key: 'assertions', label: '断言' },
  { key: 'advanced', label: '高级配置' },
  { key: 'logs', label: '执行记录' },
];

// Legacy migration: convert the old 10-action JSON shape (test_script) into
// a flat natural-language string. New code stores case_content directly; this
// only fires for rows saved before 2026-06-04.
function legacyMobileScriptToText(testScript: string): string {
  try {
    const actions = JSON.parse(testScript) as Array<Record<string, unknown>>;
    if (!Array.isArray(actions) || actions.length === 0) return '';
    const lines = actions.map((a, i) => {
      const action = String(a.action || '');
      const target = a.target ? ` "${String(a.target)}"` : '';
      const value = a.value !== undefined && a.value !== '' ? ` 值: ${String(a.value)}` : '';
      return `${i + 1}. ${action}${target}${value}`;
    });
    return `# 旧版 10-action 脚本(只读,保存后将迁移到新的用例内容)\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

const ASSERTION_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'exists', label: '存在' },
  { value: 'not_exists', label: '不存在' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const defaultAssertion = (index: number): AssertionRule => ({
  name: `规则${index}`,
  source: 'body',
  key: '',
  operator: 'equals',
  expected: '',
});

const tryFormatJson = (text: string | null) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

export default function MobileTestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [activeTab, setActiveTab] = useState('detail');
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);


  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState('android');
  const [status, setStatus] = useState('active');
  const [tags, setTags] = useState('');

  // Device config
  const [deviceName, setDeviceName] = useState('');
  const [platformVersion, setPlatformVersion] = useState('');
  const [appiumUrl, setAppiumUrl] = useState('http://localhost:4723');

  // App config
  const [appPackage, setAppPackage] = useState('');
  const [appActivity, setAppActivity] = useState('');
  const [bundleId, setBundleId] = useState('');

  // Case content (replaces the old per-step editor)
  const [caseContent, setCaseContent] = useState('');
  const [caseContentType, setCaseContentType] = useState<CaseContentType>('text');

  // Precondition: a single natural-language action handed to Midscene's
  // `aiAct` before the main case content runs. Old rows may store a JSON
  // NLStep[] — the load effect flattens those into a single text.
  const [preconditions, setPreconditions] = useState('');

  // Assertions
  const [assertions, setAssertions] = useState<AssertionRule[]>([defaultAssertion(0)]);

  // Advanced
  const [capabilities, setCapabilities] = useState('');

  // Logs
  const [logs, setLogs] = useState<MobileTestLog[]>([]);
  const [latestReportUrl, setLatestReportUrl] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);



  // Load existing
  useEffect(() => {
    if (isNew) return;
    apiFetch<MobileTestCase>(`/mobile-tests/${id}`).then(res => {
      if (res.code === 200 && res.data) {
        const d = res.data;
        setName(d.name);
        setDescription(d.description || '');
        setPlatform(d.platform);
        setStatus(d.status);
        setTags(d.tags || '');
        setDeviceName(d.device_name || '');
        setPlatformVersion(d.platform_version || '');
        setAppiumUrl(d.appium_url || 'http://localhost:4723');
        setAppPackage(d.app_package || '');
        setAppActivity(d.app_activity || '');
        setBundleId(d.bundle_id || '');
        setCapabilities(tryFormatJson(d.capabilities));
        if (d.case_content !== undefined && d.case_content !== null) {
          setCaseContent(d.case_content);
          setCaseContentType(d.case_content_type === 'yaml' ? 'yaml' : 'text');
        } else if (d.test_script) {
          // Legacy row: surface the old 10-action script as readable text
          // so the user can re-author it in the new editor.
          setCaseContent(legacyMobileScriptToText(d.test_script));
          setCaseContentType('text');
        } else {
          setCaseContent('');
          setCaseContentType('text');
        }
        if (d.preconditions) {
          // Backward compat: old rows may store a JSON NLStep[].
          const t = d.preconditions.trimStart();
          if (t.startsWith('[')) {
            try {
              const legacy = JSON.parse(d.preconditions) as Array<{ description?: string; expect?: string }>;
              setPreconditions(legacy.map(s => s.expect ? `${s.description}\n期望: ${s.expect}` : (s.description || '')).filter(Boolean).join('\n'));
            } catch { setPreconditions(d.preconditions); }
          } else {
            setPreconditions(d.preconditions);
          }
        }
        try {
          const a = JSON.parse(d.assertions || '[]');
          setAssertions(a.length > 0 ? a : [defaultAssertion(0)]);
        } catch { setAssertions([defaultAssertion(0)]); }
      }
    });
  }, [id, isNew]);

  // Load logs
  useEffect(() => {
    if (isNew) return;
    apiFetch<MobileTestLog[]>(`/mobile-tests/${id}/logs`).then(res => {
      if (res.code === 200 && res.data) setLogs(res.data);
    });
  }, [id, isNew, executing]);

  // Phase 5: load latest execution with a Midscene report (if any)
  useEffect(() => {
    if (isNew) return;
    apiFetch<any>(`/mobile-tests/${id}/executions?limit=1`).then(res => {
      if (res.code === 200 && res.data && res.data.length > 0) {
        setLatestReportUrl(res.data[0].report_url || null);
      } else {
        setLatestReportUrl(null);
      }
    }).catch(() => setLatestReportUrl(null));
  }, [id, isNew, logs.length]);

  const handleSave = async () => {
    if (!name.trim()) { notification.error('请输入用例名称'); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description,
        platform,
        status,
        tags,
        device_name: deviceName,
        platform_version: platformVersion,
        appium_url: appiumUrl,
        app_package: appPackage,
        app_activity: appActivity,
        bundle_id: bundleId,
        capabilities: capabilities || null,
        case_content: caseContent,
        case_content_type: caseContentType,
        preconditions,
        // Keep test_script populated so the legacy 10-action executor path
        // (Phase 4 deviation) still works on old data until the next save
        // overwrites it with the new case_content.
        test_script: JSON.stringify([]),
        assertions: JSON.stringify(assertions),
      };

      if (isNew) {
        const res = await apiFetch<{ id: number }>('/mobile-tests', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.code === 201 && res.data) {
          notification.success('创建成功');
          navigate(`/mobile-test/test-case/${res.data.id}`, { replace: true });
        }
      } else {
        await apiFetch(`/mobile-tests/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        notification.success('保存成功');
      }
    } catch {
      notification.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    if (isNew) { notification.error('请先保存用例'); return; }
    setExecuting(true);
    try {
      const res = await apiFetch(`/mobile-tests/${id}/execute`, { method: 'POST' });
      if (res.code === 200) {
        notification.success('执行完成');
        setActiveTab('logs');
      } else {
        notification.error('执行失败');
      }
    } catch {
      notification.error('执行出错');
    } finally {
      setExecuting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确认删除此测试用例？')) return;
    await apiFetch(`/mobile-tests/${id}`, { method: 'DELETE' });
    navigate('/mobile-test/test-case');
  };

  // Assertion management
  const updateAssertion = (i: number, field: keyof AssertionRule, value: string) => {
    setAssertions(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };
  const addAssertion = () => setAssertions(prev => [...prev, defaultAssertion(prev.length)]);
  const removeAssertion = (i: number) => setAssertions(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div className="mtd">
      {/* Toast */}
      {toast && <div className={`mtd-toast mtd-toast-${toast.type}`}>{toast.msg}</div>}

      {/* Header */}
      <div className="mtd-header">
        <button className="mtd-back" onClick={() => navigate('/mobile-test/test-case')}>←</button>
        <input
          className="mtd-title-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="输入测试用例名称"
        />
        <div className="mtd-actions">
          <button className="scenario-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="sset-btn sset-btn-primary" onClick={handleExecute} disabled={executing || isNew}>
            {executing ? '执行中...' : '执行'}
          </button>
          {!isNew && (
            <button className="mtd-btn mtd-btn-del" onClick={handleDelete}>删除</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mtd-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`mtd-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mtd-body">
        {/* ── Detail ── */}
        {activeTab === 'detail' && (
          <div className="mtd-form">
            <div className="mtd-field">
              <label>用例名称</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="输入用例名称" />
            </div>
            <div className="mtd-field">
              <label>描述</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="输入用例描述" rows={3} />
            </div>
            <div className="mtd-row">
              <div className="mtd-field">
                <label>平台</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </select>
              </div>
              <div className="mtd-field">
                <label>状态</label>
                <select value={status} onChange={e => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="mtd-field">
              <label>标签</label>
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
            </div>
          </div>
        )}

        {/* ── Precondition ── */}
        {activeTab === 'precondition' && (
          <div className="mtd-form">
            <div className="mtd-field">
              <label>前置动作(自然语言描述,执行用例前由 Midscene aiAct 执行)</label>
              <textarea
                value={preconditions}
                onChange={e => setPreconditions(e.target.value)}
                placeholder="例:打开应用,确认未登录状态"
                rows={8}
              />
              <div className="mtd-field-hint">
                留空则不执行前置动作。整段文本会原样交给 Midscene 的 aiAct()。
              </div>
            </div>
          </div>
        )}

        {/* ── Device Config ── */}
        {activeTab === 'device' && (
          <div className="mtd-form">
            <div className="mtd-field">
              <label>当前平台</label>
              <div style={{ padding: '8px 0', color: '#10b981', fontWeight: 600 }}>
                {platform === 'ios' ? 'iOS (WebDriverAgent)' : 'Android (ADB)'}
              </div>
            </div>
            <div className="mtd-row">
              <div className="mtd-field">
                <label>设备名称</label>
                <input value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder={platform === 'ios' ? '如: iPhone 15' : '如: Pixel 7'} />
              </div>
              <div className="mtd-field">
                <label>系统版本</label>
                <input value={platformVersion} onChange={e => setPlatformVersion(e.target.value)} placeholder={platform === 'ios' ? '如: 17.0' : '如: 14.0'} />
              </div>
            </div>
            <div className="mtd-field">
              <label>Appium URL</label>
              <input value={appiumUrl} onChange={e => setAppiumUrl(e.target.value)} placeholder="http://localhost:4723" />
              <div className="mtd-field-hint">
                {platform === 'ios'
                  ? 'iOS 通过 WebDriverAgent (WDA) 进行通信，默认端口 4723'
                  : 'Android 通过 ADB + Appium 进行通信，默认端口 4723'}
              </div>
            </div>
          </div>
        )}

        {/* ── App Config ── */}
        {activeTab === 'app' && (
          <div className="mtd-form">
            {platform === 'android' ? (
              <div className="mtd-platform-section">
                <div className="mtd-platform-title">
                  <span className="mtlist-platform mtlist-platform-android">Android</span>
                  应用配置
                </div>
                <div className="mtd-field">
                  <label>包名 (Package Name)</label>
                  <input value={appPackage} onChange={e => setAppPackage(e.target.value)} placeholder="com.example.app" />
                  <div className="mtd-field-hint">应用的唯一包名，如 com.tencent.mm</div>
                </div>
                <div className="mtd-field">
                  <label>启动 Activity</label>
                  <input value={appActivity} onChange={e => setAppActivity(e.target.value)} placeholder="com.example.app.MainActivity" />
                  <div className="mtd-field-hint">应用启动时的入口 Activity</div>
                </div>
              </div>
            ) : (
              <div className="mtd-platform-section">
                <div className="mtd-platform-title">
                  <span className="mtlist-platform mtlist-platform-ios">iOS</span>
                  应用配置
                </div>
                <div className="mtd-field">
                  <label>Bundle ID</label>
                  <input value={bundleId} onChange={e => setBundleId(e.target.value)} placeholder="com.example.app" />
                  <div className="mtd-field-hint">iOS 应用的唯一标识，如 com.tencent.xin</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Case Content ── */}
        {activeTab === 'content' && (
          <div className="mtd-form">
            <CaseContentEditor
              value={caseContent}
              type={caseContentType}
              onChange={setCaseContent}
              onTypeChange={setCaseContentType}
            />
          </div>
        )}

        {/* ── Assertions ── */}
        {activeTab === 'assertions' && (
          <div className="mtd-form">
            <div className="mtd-steps">
              {assertions.map((a, i) => (
                <div key={i} className="mtd-assertion-row">
                  <input value={a.name || ''} onChange={e => updateAssertion(i, 'name', e.target.value)} placeholder="规则名" style={{ width: 100 }} />
                  <select value={a.source} onChange={e => updateAssertion(i, 'source', e.target.value)}>
                    <option value="body">响应体</option>
                    <option value="status">状态</option>
                    <option value="header">元素属性</option>
                  </select>
                  <input value={a.key} onChange={e => updateAssertion(i, 'key', e.target.value)} placeholder="字段" style={{ width: 120 }} />
                  <select value={a.operator} onChange={e => updateAssertion(i, 'operator', e.target.value)}>
                    {ASSERTION_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  <input value={a.expected} onChange={e => updateAssertion(i, 'expected', e.target.value)} placeholder="期望值" style={{ flex: 1 }} />
                  <button className="mtd-step-del" onClick={() => removeAssertion(i)}>×</button>
                </div>
              ))}
            </div>
            <button className="mtd-step-add" onClick={addAssertion}>+ 添加断言规则</button>
          </div>
        )}

        {/* ── Advanced ── */}
        {activeTab === 'advanced' && (
          <div className="mtd-form">
            <div className="mtd-field">
              <label>Appium Capabilities (JSON)</label>
              <CodeMirror
                value={capabilities}
                onChange={setCapabilities}
                extensions={[json(), linter(jsonParseLinter())]}
                height="200px"
                theme="light"
                basicSetup={{ lineNumbers: true }}
              />
              <div className="mtd-field-hint">
                额外的 Appium capabilities，如 automationName、noReset 等
              </div>
            </div>
          </div>
        )}

        {/* ── Logs ── */}
        {activeTab === 'logs' && (
          <div className="mtd-form">
            <MidsceneReportViewer reportPath={latestReportUrl} label="最近一次执行的 Midscene 报告" />
            {logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>暂无执行记录</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="mtd-log-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`mtd-log-status mtd-log-status-${log.status}`}>{log.status}</span>
                    <span style={{ fontWeight: 500 }}>{log.duration_ms}ms</span>
                    {log.executed_by && <span>by {log.executed_by}</span>}
                  </div>
                  <div className="mtd-log-meta">{formatDateTime(log.executed_at)}</div>
                  {log.error_message && <div style={{ color: '#ff4d4f', marginTop: 4 }}>{log.error_message}</div>}
                  {log.result && (
                    <div className="mtd-log-steps">
                      {(() => {
                        try {
                          const r = JSON.parse(log.result);
                          return r.steps?.map((s: { action: string; status: string; target?: string; error?: string }, i: number) =>
                            `${i + 1}. [${s.status}] ${s.action}${s.target ? ` → ${s.target}` : ''}${s.error ? ` (${s.error})` : ''}`
                          ).join('\n') || log.result;
                        } catch { return log.result; }
                      })()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
