import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { MobileTestCase, MobileTestLog, MobileTestStep, AssertionRule } from '../../types';
import './MobileTestDetail.css';

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'device', label: '设备配置' },
  { key: 'app', label: '应用配置' },
  { key: 'steps', label: '测试步骤' },
  { key: 'assertions', label: '断言' },
  { key: 'advanced', label: '高级配置' },
  { key: 'logs', label: '执行记录' },
];

const STEP_ACTIONS: { value: MobileTestStep['action']; label: string }[] = [
  { value: 'launch', label: '启动应用' },
  { value: 'tap', label: '点击' },
  { value: 'input', label: '输入' },
  { value: 'swipe', label: '滑动' },
  { value: 'scroll', label: '滚动' },
  { value: 'screenshot', label: '截图' },
  { value: 'assert', label: '断言' },
  { value: 'back', label: '返回' },
  { value: 'home', label: 'Home' },
  { value: 'sleep', label: '等待' },
];

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

const defaultStep = (index: number): MobileTestStep => ({
  action: 'tap',
  target: '',
});

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

  // Steps
  const [steps, setSteps] = useState<MobileTestStep[]>([defaultStep(0)]);

  // Assertions
  const [assertions, setAssertions] = useState<AssertionRule[]>([defaultAssertion(0)]);

  // Advanced
  const [capabilities, setCapabilities] = useState('');

  // Logs
  const [logs, setLogs] = useState<MobileTestLog[]>([]);



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
        try {
          const s = JSON.parse(d.test_script || '[]');
          setSteps(s.length > 0 ? s : [defaultStep(0)]);
        } catch { setSteps([defaultStep(0)]); }
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
        test_type: 'mobile',
        device_name: deviceName,
        platform_version: platformVersion,
        appium_url: appiumUrl,
        app_package: appPackage,
        app_activity: appActivity,
        bundle_id: bundleId,
        capabilities: capabilities || null,
        test_script: JSON.stringify(steps),
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

  // Step management
  const updateStep = (i: number, field: keyof MobileTestStep, value: string | number) => {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };
  const addStep = () => setSteps(prev => [...prev, defaultStep(prev.length)]);
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, idx) => idx !== i));

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
          <button className="mtd-btn mtd-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="mtd-btn mtd-btn-exec" onClick={handleExecute} disabled={executing || isNew}>
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

        {/* ── Test Steps ── */}
        {activeTab === 'steps' && (
          <div className="mtd-form">
            <div className="mtd-steps">
              {steps.map((step, i) => (
                <div key={i} className="mtd-step-row">
                  <div className="mtd-step-num">{i + 1}</div>
                  <select
                    className="mtd-step-action"
                    value={step.action}
                    onChange={e => updateStep(i, 'action', e.target.value)}
                  >
                    {STEP_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {(step.action === 'tap' || step.action === 'input' || step.action === 'assert' || step.action === 'swipe') && (
                    <input
                      className="mtd-step-input"
                      value={step.target || ''}
                      onChange={e => updateStep(i, 'target', e.target.value)}
                      placeholder={step.action === 'tap' || step.action === 'swipe' ? '坐标 x,y 或元素描述' : '目标元素'}
                    />
                  )}
                  {step.action === 'input' && (
                    <input
                      className="mtd-step-input"
                      value={step.value || ''}
                      onChange={e => updateStep(i, 'value', e.target.value)}
                      placeholder="输入内容"
                    />
                  )}
                  {step.action === 'sleep' && (
                    <input
                      className="mtd-step-input"
                      type="number"
                      value={step.duration || 1000}
                      onChange={e => updateStep(i, 'duration', Number(e.target.value))}
                      placeholder="毫秒"
                      style={{ maxWidth: 100 }}
                    />
                  )}
                  {step.action === 'scroll' && (
                    <select
                      className="mtd-step-action"
                      value={step.direction || 'down'}
                      onChange={e => updateStep(i, 'direction', e.target.value)}
                    >
                      <option value="up">上</option>
                      <option value="down">下</option>
                      <option value="left">左</option>
                      <option value="right">右</option>
                    </select>
                  )}
                  <button className="mtd-step-del" onClick={() => removeStep(i)} title="删除">×</button>
                </div>
              ))}
            </div>
            <button className="mtd-step-add" onClick={addStep}>+ 添加步骤</button>
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
