import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import TagInput from '../../components/TagInput';
import FormSelect from '../../components/FormSelect';
import LogTab, { type ExecRecord } from '../../components/tabs/LogTab';
import ThemedCodeMirror from '../../components/ThemedCodeMirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { CaseContentEditor, type CaseContentType } from '../../components/CaseContentEditor';
import DevicePickerModal from '../../components/DevicePickerModal';
import MobilePreviewPanel from '../../components/MobilePreviewPanel';
import { usePreviewSession, type SseFrameEvent, type ScrcpyEvent } from '../../hooks/usePreviewSession';
import { useScrcpyDecoder, type ScrcpyMetadata } from '../../hooks/useScrcpyDecoder';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { formatDateTime, formatDuration } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { MobileTestCase, AssertionRule, TextAssertion, PreviewKind, MobileExecuteResult, MobileApp, MobileAppVersion } from '../../types';
import type { PickerDevice } from '../../components/DevicePickerModal';
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

const defaultTextAssertion = (): TextAssertion => ({
  type: 'text',
  text: '',
});

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const tryFormatJson = (text: string | null) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

/**
 * 2026-06-10: 根据设备来源/平台决定 preview kind,UI 跟 server proxy 能力对齐。
 *  - Android:本地 + 远端都走 scrcpy(WebSocket,H.264 高帧率)。本地由 server 进程
 *    in-process 启 adb + scrcpy-server,远端走 mobile-agent 中转。
 *  - Harmony 始终走 screenshot(1.6 FPS)
 *  - iOS 始终走 mjpeg(5 FPS);本地走 server 端启 WDA,远端走 mac agent
 */
function decidePreviewKind(device: PickerDevice): PreviewKind {
  if (device.platform === 'android') {
    return 'scrcpy';
  }
  if (device.platform === 'harmony') return 'screenshot';
  return 'mjpeg';
}

export default function MobileTestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeEnv } = useEnvironment();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = !id || id === 'new';

  const [activeTab, setActiveTab] = useState('detail');
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);

  // Dirty state tracking — true when current form diverges from last saved snapshot
  const originalSnapshotRef = useRef<string>('');
  const [dirty, setDirty] = useState(false);

  // 2026-06-09: 执行流 — 选设备 → 启动预览
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | string | null>(null);
  const [selectedDeviceName, setSelectedDeviceName] = useState<string | null>(null);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  // true = 从执行按钮触发的选择(选完自动执行); false = 从按钮触发(只选设备连预览)
  const pendingExecuteFromRef = useRef(false);
  const [preview, setPreview] = useState<{
    open: boolean;
    device: PickerDevice | null;
    kind: PreviewKind;
    caseExecutionId: number | null;
    /** true = 预览就绪后自动触发执行 */
    pendingExecute: boolean;
  }>({ open: false, device: null, kind: 'screenshot', caseExecutionId: null, pendingExecute: false });

  // ── Preview session + decoder (moved from MobilePreviewDrawer) ──
  const session = usePreviewSession({
    deviceId: preview.device?.id ?? '',
    serial: preview.device?.serial ?? undefined,
    kind: preview.kind,
    caseExecutionId: preview.caseExecutionId ?? undefined,
    enabled: preview.open && !!preview.device,
  });

  const [previewSessionState, setPreviewSessionState] = useState<'idle' | 'starting' | 'streaming' | 'error'>('idle');

  useEffect(() => {
    setPreviewSessionState(session.state.kind);
  }, [session.state.kind]);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [scrcpyStatus, setScrcpyStatus] = useState<'idle' | 'open' | 'closed' | 'error'>('idle');
  const [scrcpyMetadata, setScrcpyMetadata] = useState<ScrcpyMetadata | null>(null);
  const [scrcpyError, setScrcpyError] = useState<string | null>(null);

  const scrcpy = useScrcpyDecoder({
    canvas: preview.kind === 'scrcpy' ? canvasRef.current : null,
    metadata: scrcpyMetadata,
  });

  // Subscribe to SSE frames (screenshot / mjpeg)
  useEffect(() => {
    if (preview.kind !== 'screenshot' && preview.kind !== 'mjpeg') return;
    session.onFrame?.((e: SseFrameEvent) => {
      const src = `data:image/png;base64,${e.image}`;
      if (imgRef.current) {
        imgRef.current.src = src;
      }
      setFrameCount((c) => c + 1);
    });
  }, [preview.kind, session]);

  // Subscribe to scrcpy events
  useEffect(() => {
    if (preview.kind !== 'scrcpy') return;
    session.onScrcpyEvent?.((e: ScrcpyEvent) => {
      if (e.type === 'open') setScrcpyStatus('open');
      else if (e.type === 'close') setScrcpyStatus('closed');
      else if (e.type === 'error') {
        setScrcpyStatus('error');
        setScrcpyError(e.message);
      } else if (e.type === 'metadata') {
        setScrcpyError(null);
        setScrcpyMetadata(e.metadata);
      } else if (e.type === 'frame') {
        scrcpy.push(e.bytes);
        setFrameCount((c) => c + 1);
      }
    });
  }, [preview.kind, session, scrcpy]);

  // Reset preview stats when preview closes
  useEffect(() => {
    if (!preview.open) {
      setFrameCount(0);
      setScrcpyStatus('idle');
      setScrcpyMetadata(null);
      setScrcpyError(null);
      if (imgRef.current) imgRef.current.src = '';
    }
  }, [preview.open]);

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

  // App association (mobile_apps)
  const [appId, setAppId] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [availableApps, setAvailableApps] = useState<MobileApp[]>([]);
  const [appVersions, setAppVersions] = useState<MobileAppVersion[]>([]);

  // Case content (replaces the old per-step editor)
  const [caseContent, setCaseContent] = useState('');
  const [caseContentType, setCaseContentType] = useState<CaseContentType>('text');

  // Precondition: a single natural-language action handed to Midscene's
  // `aiAct` before the main case content runs. Old rows may store a JSON
  // NLStep[] — the load effect flattens those into a single text.
  const [preconditions, setPreconditions] = useState('');

  // Assertions — natural language text, executed by Midscene aiAssert
  const [assertions, setAssertions] = useState<TextAssertion[]>([defaultTextAssertion()]);

  // Advanced
  const [capabilities, setCapabilities] = useState('');

  // Executions with report_url
  const [executions, setExecutions] = useState<Array<{ id: number; status: string; started_at: string; finished_at: string | null; duration_ms: number | null; error_message: string | null; report_url: string | null }>>([]);
  // Header meta
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Build snapshot string from all saveable fields — used for dirty detection
  const buildSnapshot = () => JSON.stringify({
    name, description, platform, status, tags,
    deviceName, platformVersion, appiumUrl,
    appPackage, appActivity, bundleId,
    caseContent, caseContentType,
    preconditions,
    assertions: assertions.map(({ type, text }) => ({ type, text })),
    capabilities,
    appId, appVersion,
  });

  // Compute dirty: compare current state to last saved snapshot
  useEffect(() => {
    setDirty(buildSnapshot() !== originalSnapshotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, platform, status, tags, deviceName, platformVersion, appiumUrl, appPackage, appActivity, bundleId, caseContent, caseContentType, preconditions, assertions, capabilities, appId, appVersion]);

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
        setUpdatedAt(d.updated_at || null);
        setDeviceName(d.device_name || '');
        setPlatformVersion(d.platform_version || '');
        setAppiumUrl(d.appium_url || 'http://localhost:4723');
        setAppPackage(d.app_package || '');
        setAppActivity(d.app_activity || '');
        setBundleId(d.bundle_id || '');
        setAppId(d.app_id ?? null);
        setAppVersion(d.app_version || '');
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
          if (a.length > 0) {
            // Detect format: old structured (has 'source'/'key'/'operator') vs new text (has 'type'='text')
            if (a[0] && a[0].type === 'text') {
              setAssertions(a as TextAssertion[]);
            } else {
              // Legacy structured → convert to text lines
              const lines = a.map((r: AssertionRule) =>
                [r.name, r.source, r.key, r.operator, r.expected].filter(Boolean).join(' ')
              ).filter(Boolean);
              setAssertions(lines.length > 0
                ? [{ type: 'text', text: lines.join('\n') }]
                : [defaultTextAssertion()]);
            }
          } else {
            setAssertions([defaultTextAssertion()]);
          }
        } catch { setAssertions([defaultTextAssertion()]); }
        // Capture snapshot after state setters flush so initial dirty === false
        queueMicrotask(() => {
          originalSnapshotRef.current = buildSnapshot();
        });
      }
    });
  }, [id, isNew]);

  // Load all executions with report_url
  useEffect(() => {
    if (isNew) return;
    apiFetch<any[]>(`/mobile-tests/${id}/executions?limit=20`).then(res => {
      if (res.code === 200 && res.data) {
        setExecutions(res.data);
      }
    }).catch(() => setExecutions([]));
  }, [id, isNew]);

  // Fetch available mobile apps for the association dropdown
  useEffect(() => {
    apiFetch<MobileApp[]>('/mobile-apps').then(res => {
      if (res.code === 200 && res.data) setAvailableApps(res.data);
    }).catch(() => {});
  }, []);

  // When appId changes, populate version list from the selected app
  useEffect(() => {
    if (!appId) { setAppVersions([]); return; }
    const app = availableApps.find(a => a.id === appId);
    if (app) {
      try { setAppVersions(JSON.parse(app.versions)); } catch { setAppVersions([]); }
    } else {
      setAppVersions([]);
    }
  }, [appId, availableApps]);

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
        app_id: appId ?? null,
        app_version: appVersion || null,
      };

      if (isNew) {
        const res = await apiFetch<{ id: number }>('/mobile-tests', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.code === 201 && res.data) {
          notification.success('创建成功');
          navigate(`/mobile-test/case/${res.data.id}`, { replace: true });
        }
      } else {
        await apiFetch(`/mobile-tests/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        notification.success('保存成功');
        // Refresh snapshot so the save button stops pulsing
        originalSnapshotRef.current = buildSnapshot();
        setDirty(false);
      }
    } catch {
      notification.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 2026-06-11: preview session 跟页面绑定,不跟单次执行绑定。
  // 预览已经在 streaming → 直接执行;已选设备但未就绪 → 等 streaming 再执行;没有设备 → 先选设备。
  const handleExecute = async () => {
    if (isNew) { notification.error('请先保存用例'); return; }
    // 预览已经在流式传输 → 直接执行,不需要重新选设备/重连
    if (preview.open && preview.device && previewSessionState === 'streaming') {
      setExecuting(true);
      const device = preview.device;
      try {
        const deviceIdParam = device.remote_device_id || device.id;
        const url = deviceIdParam
          ? `/mobile-tests/${id}/execute?deviceId=${encodeURIComponent(String(deviceIdParam))}`
          : `/mobile-tests/${id}/execute`;
        const res = await apiFetch<MobileExecuteResult>(url, {
          method: 'POST',
          body: JSON.stringify({ environmentId: activeEnv?.id }),
        });
        if (res.code !== 200 || !res.data) {
          notification.error(res.message || '执行启动失败');
          return;
        }
        if (res.data.status === 'success') {
          notification.success('执行完成');
        } else {
          notification.error(`执行失败: ${res.data.error_message || '未知错误'}`);
        }
        setActiveTab('logs');
        const newExecId = res.data.execution_id ?? null;
        setPreview(p => ({ ...p, caseExecutionId: newExecId }));
        if (newExecId) {
          apiFetch<any[]>(`/mobile-tests/${id}/executions?limit=20`).then(execRes => {
            if (execRes.code === 200 && execRes.data) {
              setExecutions(execRes.data);
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.error(`[mtd] execute failed: ${e instanceof Error ? e.message : String(e)}`);
        notification.error('执行启动出错');
      } finally {
        setExecuting(false);
      }
      return;
    }
    // 已选设备但预览未就绪 → 等 streaming 后自动执行
    if (preview.open && preview.device) {
      setPreview(p => ({ ...p, pendingExecute: true }));
      return;
    }
    // 没有设备 → 先选设备(选完自动执行)
    pendingExecuteFromRef.current = true;
    setDevicePickerOpen(true);
  };

  // 2026-06-11: 选了设备 → 开预览面板 → 等屏幕连上 → 再发执行请求。
  // preview session 跟页面绑定:同设备不重建,换设备才重建。
  const handleDeviceSelected = (device: PickerDevice) => {
    setDevicePickerOpen(false);
    if (device.busy) {
      notification.error(`设备 ${device.name} 正被其他会话占用，请稍后再试`);
      return;
    }
    setSelectedDeviceId(device.id);
    setSelectedDeviceName(device.name);
    const kind = decidePreviewKind(device);
    // 同设备:preview session 还在(hook deps 不变,WS 不断),直接标记 pendingExecute
    const isSameDevice = preview.open && preview.device && String(preview.device.id) === String(device.id);
    if (!isSameDevice) {
      // 不同设备:重置 session state,让 hook 重新启动
      setPreviewSessionState('idle');
    }
    const shouldAutoExecute = pendingExecuteFromRef.current;
    pendingExecuteFromRef.current = false;
    console.log(`[mtd] preview device=${device.id} platform=${device.platform} kind=${kind} sameDevice=${isSameDevice} autoExecute=${shouldAutoExecute}`);
    setPreview({
      open: true,
      device,
      kind,
      caseExecutionId: null,
      pendingExecute: shouldAutoExecute,
    });
  };

  // 从设备选择按钮触发:只选设备+连预览,不自动执行
  const handlePickerButtonClick = () => {
    pendingExecuteFromRef.current = false;
    setDevicePickerOpen(true);
  };

  // 本地执行:清掉选中设备,关闭预览,直接执行
  const handleLocalExecute = () => {
    setSelectedDeviceId(null);
    setSelectedDeviceName(null);
    setDevicePickerOpen(false);
    setPreview(p => ({ ...p, open: false, device: null, pendingExecute: false }));
    // 本地执行
    setExecuting(true);
    apiFetch<MobileExecuteResult>(`/mobile-tests/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ environmentId: activeEnv?.id }),
    }).then(res => {
      if (res.code !== 200 || !res.data) {
        notification.error(res.message || '执行启动失败');
        return;
      }
      if (res.data.status === 'success') {
        notification.success('执行完成');
      } else {
        notification.error(`执行失败: ${res.data.error_message || '未知错误'}`);
      }
      setActiveTab('logs');
    }).catch(e => {
      console.error(`[mtd] local execute failed: ${e instanceof Error ? e.message : String(e)}`);
      notification.error('执行启动出错');
    }).finally(() => setExecuting(false));
  };

  // 2026-06-11: 预览就绪后自动触发执行。previewSessionState 由 hook 同步。
  useEffect(() => {
    if (!preview.pendingExecute) return;
    if (previewSessionState !== 'streaming') return;
    if (!preview.device || isNew || executing) return;

    // 消费 pendingExecute,避免重复触发
    setPreview(p => ({ ...p, pendingExecute: false }));
    setExecuting(true);

    const device = preview.device;
    const run = async () => {
      try {
        const deviceIdParam = device.remote_device_id || device.id;
        const url = deviceIdParam
          ? `/mobile-tests/${id}/execute?deviceId=${encodeURIComponent(String(deviceIdParam))}`
          : `/mobile-tests/${id}/execute`;
        const res = await apiFetch<MobileExecuteResult>(url, {
          method: 'POST',
          body: JSON.stringify({ environmentId: activeEnv?.id }),
        });
        if (res.code !== 200 || !res.data) {
          notification.error(res.message || '执行启动失败');
          if (res.code === 409) {
            setPreview(p => ({ ...p, open: false, pendingExecute: false }));
          }
          return;
        }
        if (res.data.status === 'success') {
          notification.success('执行完成');
        } else {
          notification.error(`执行失败: ${res.data.error_message || '未知错误'}`);
        }
        setActiveTab('logs');
        const newExecId = res.data!.execution_id ?? null;
        setPreview(p => ({ ...p, caseExecutionId: newExecId }));
        // Re-fetch executions then auto-select the new one
        if (newExecId) {
          apiFetch<any[]>(`/mobile-tests/${id}/executions?limit=20`).then(execRes => {
            if (execRes.code === 200 && execRes.data) {
              setExecutions(execRes.data);
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.error(`[mtd] execute failed: ${e instanceof Error ? e.message : String(e)}`);
        notification.error('执行启动出错');
      } finally {
        setExecuting(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSessionState, preview.pendingExecute, preview.device, isNew, executing]);

  // 预览连接失败时,取消 pendingExecute
  useEffect(() => {
    if (preview.pendingExecute && previewSessionState === 'error') {
      setPreview(p => ({ ...p, pendingExecute: false }));
      setExecuting(false);
    }
  }, [previewSessionState, preview.pendingExecute]);

  // 2026-06-09: 列表页 ▶ 按钮 → navigate('/mobile-test/case/:id?autoExecute=1')
  // 详情页读 autoExecute=1 → 自动开 picker。注意只触发一次,用户在 picker 选了/取消后
  // 必须清掉 query,否则 refresh 会再触发。
  useEffect(() => {
    if (isNew) return;
    if (searchParams.get('autoExecute') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('autoExecute');
      setSearchParams(next, { replace: true });
      setDevicePickerOpen(true);
    }
    // 只在初次加载(id 变化)时检查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 关预览面板
  const closePreview = () => {
    setPreview((p) => ({ ...p, open: false, pendingExecute: false }));
    setPreviewSessionState('idle');
  };

  // Assertion management — natural language text blocks
  const updateAssertionText = (i: number, text: string) => {
    setAssertions(prev => prev.map((a, idx) => idx === i ? { ...a, text } : a));
  };
  const addAssertion = () => setAssertions(prev => [...prev, defaultTextAssertion()]);
  const removeAssertion = (i: number) => setAssertions(prev => prev.filter((_, idx) => idx !== i));

  // Build LogTab-compatible records
  const execRecords: ExecRecord[] = useMemo(() =>
    executions.map(e => ({
      id: e.id,
      time: formatDateTime(e.started_at),
      status: (e.status === 'success' || e.status === 'failed' || e.status === 'error') ? e.status : 'running',
      duration: formatDuration(e.duration_ms),
      executor: '-',
      passRate: '-',
      reportUrl: e.report_url,
      errorMessage: e.error_message,
    })),
    [executions],
  );
  const latestReportUrl = useMemo(() => {
    const withReport = executions.find(e => e.report_url);
    return withReport?.report_url ?? null;
  }, [executions]);

  return (
    <div className="api-detail page-enter">

      {/* Header */}
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate('/mobile-test/case')}>用例列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input
            className="api-detail-name-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="输入测试用例名称"
          />
        </div>
        <div className="api-detail-meta">
          {!isNew && (
            <span className={`status-badge-light ${status}`}>
              {STATUS_OPTIONS.find(o => o.value === status)?.label || status}
            </span>
          )}
          {updatedAt && (
            <span className="meta-time">更新于 {formatDateTime(updatedAt)}</span>
          )}
        </div>
        <div className="api-detail-actions">
          <button
            type="button"
            className="scenario-btn"
            onClick={handlePickerButtonClick}
            disabled={executing || preview.pendingExecute}
            title="选择执行设备"
          >
            {selectedDeviceName || '本机'}
          </button>
          <button className={`scenario-btn ${dirty ? 'dirty' : ''}`} onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="sset-btn sset-btn-primary" onClick={handleExecute} disabled={executing || preview.pendingExecute || isNew}>
            {executing ? '执行中...' : preview.pendingExecute ? '连接中...' : selectedDeviceId ? '远程执行' : '执行'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`api-detail-content${preview.open && preview.device ? ' api-detail-content--with-preview' : ''}`}>
        <div className="api-detail-card">
          {/* Tabs */}
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

          {/* Tab content */}
          <div className="tab-body">
          {/* ── Detail ── */}
          {activeTab === 'detail' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>基本信息</label></div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>用例名称</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="输入用例名称" />
                  </div>
                </div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>描述</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="输入用例描述" rows={3} />
                  </div>
                </div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>平台</label>
                    <FormSelect
                      value={platform}
                      options={[
                        { value: 'android', label: 'Android' },
                        { value: 'ios', label: 'iOS' },
                      ]}
                      onChange={setPlatform}
                    />
                  </div>
                  <div className="field">
                    <label>状态</label>
                    <FormSelect
                      value={status}
                      options={STATUS_OPTIONS}
                      onChange={setStatus}
                    />
                  </div>
                </div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>标签</label>
                    <TagInput value={tags} onChange={v => setTags(v)} placeholder="输入标签，回车确认" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Precondition ── */}
          {activeTab === 'precondition' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>前置动作</label></div>
                <div className="api-detail-row">
                  <div className="field">
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
              </div>
            </div>
          )}

          {/* ── Device Config ── */}
          {activeTab === 'device' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>设备配置</label></div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>当前平台</label>
                    <div style={{ padding: '8px 0', color: 'var(--success)', fontWeight: 600 }}>
                      {platform === 'ios' ? 'iOS (WebDriverAgent)' : 'Android (ADB)'}
                    </div>
                  </div>
                </div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>设备名称</label>
                    <input value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder={platform === 'ios' ? '如: iPhone 15' : '如: Pixel 7'} />
                  </div>
                  <div className="field">
                    <label>系统版本</label>
                    <input value={platformVersion} onChange={e => setPlatformVersion(e.target.value)} placeholder={platform === 'ios' ? '如: 17.0' : '如: 14.0'} />
                  </div>
                </div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>Appium URL</label>
                    <input value={appiumUrl} onChange={e => setAppiumUrl(e.target.value)} placeholder="http://localhost:4723" />
                    <div className="mtd-field-hint">
                      {platform === 'ios'
                        ? 'iOS 通过 WebDriverAgent (WDA) 进行通信，默认端口 4723'
                        : 'Android 通过 ADB + Appium 进行通信，默认端口 4723'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── App Config ── */}
          {activeTab === 'app' && (
            <div className="tab-content-wrapper">
              {/* App association */}
              <div className="ad-section">
                <div className="ad-section-head"><label>关联应用（可选）</label></div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>应用</label>
                    <FormSelect
                      value={String(appId ?? '')}
                      options={[
                        { value: '', label: '不关联' },
                        ...availableApps.map(a => ({ value: String(a.id), label: `${a.name} (${a.platform})` })),
                      ]}
                      onChange={v => setAppId(v ? Number(v) : null)}
                    />
                    <div className="mtd-field-hint">关联后执行时自动安装到设备。应用需先在「应用管理」中上传安装包。</div>
                  </div>
                </div>
                {appId && appVersions.length > 0 && (
                  <div className="api-detail-row">
                    <div className="field">
                      <label>安装版本</label>
                      <FormSelect
                        value={appVersion}
                        options={[
                          { value: '', label: '最新版' },
                          ...appVersions.map(v => ({ value: v.version, label: `v${v.version}` })),
                        ]}
                        onChange={setAppVersion}
                      />
                      <div className="mtd-field-hint">留空则安装最新版本。</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Platform-specific config */}
              <div className="ad-section">
                <div className="ad-section-head"><label>平台配置</label></div>
                {platform === 'android' ? (
                  <div className="mtd-platform-section">
                    <div className="mtd-platform-title">
                      <span className="mtlist-platform mtlist-platform-android">Android</span>
                      应用配置
                    </div>
                    <div className="api-detail-row">
                      <div className="field">
                        <label>包名 (Package Name)</label>
                        <input value={appPackage} onChange={e => setAppPackage(e.target.value)} placeholder="com.example.app" />
                        <div className="mtd-field-hint">应用的唯一包名，如 com.tencent.mm</div>
                      </div>
                    </div>
                    <div className="api-detail-row">
                      <div className="field">
                        <label>启动 Activity</label>
                        <input value={appActivity} onChange={e => setAppActivity(e.target.value)} placeholder="com.example.app.MainActivity" />
                        <div className="mtd-field-hint">应用启动时的入口 Activity</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mtd-platform-section">
                    <div className="mtd-platform-title">
                      <span className="mtlist-platform mtlist-platform-ios">iOS</span>
                      应用配置
                    </div>
                    <div className="api-detail-row">
                      <div className="field">
                        <label>Bundle ID</label>
                        <input value={bundleId} onChange={e => setBundleId(e.target.value)} placeholder="com.example.app" />
                        <div className="mtd-field-hint">iOS 应用的唯一标识，如 com.tencent.xin</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Case Content ── */}
          {activeTab === 'content' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>用例内容</label></div>
                <CaseContentEditor
                  value={caseContent}
                  type={caseContentType}
                  onChange={setCaseContent}
                  onTypeChange={setCaseContentType}
                />
              </div>
            </div>
          )}

          {/* ── Assertions ── */}
          {activeTab === 'assertions' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>断言规则</label></div>
                <div className="mtd-assertion-list">
                  {assertions.map((a, i) => (
                    <div key={i} className="mtd-assertion-text-row">
                      <div className="mtd-assertion-text-header">
                        <span className="mtd-assertion-text-num">{i + 1}</span>
                        <button className="mtd-step-del" onClick={() => removeAssertion(i)}>×</button>
                      </div>
                      <textarea
                        value={a.text}
                        onChange={e => updateAssertionText(i, e.target.value)}
                        placeholder="例: 页面上应该显示&#10;&#10;登录成功&#10;&#10;欢迎回来"
                        rows={3}
                      />
                    </div>
                  ))}
                </div>
                <button className="ad-btn ad-btn-sm" onClick={addAssertion}>+ 添加断言</button>
                <div className="mtd-field-hint" style={{ marginTop: 8 }}>
                  每条断言用自然语言描述期望的页面状态。执行时由 Midscene 的 aiAssert() 验证。支持多行描述。
                </div>
              </div>
            </div>
          )}

          {/* ── Advanced ── */}
          {activeTab === 'advanced' && (
            <div className="tab-content-wrapper">
              <div className="ad-section">
                <div className="ad-section-head"><label>高级配置</label></div>
                <div className="api-detail-row">
                  <div className="field">
                    <label>Appium Capabilities (JSON)</label>
                    <ThemedCodeMirror
                      value={capabilities}
                      onChange={setCapabilities}
                      extensions={[json(), linter(jsonParseLinter())]}
                      height="200px"
                      basicSetup={{ lineNumbers: true }}
                    />
                    <div className="mtd-field-hint">
                      额外的 Appium capabilities，如 automationName、noReset 等
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Logs ── */}
          {activeTab === 'logs' && (
            <LogTab latestReportUrl={latestReportUrl} execRecords={execRecords} reportLabel="移动端测试报告" />
          )}
        </div>
        </div>

        {/* Preview panel — side-by-side with tab content */}
        {preview.open && preview.device && (
          <div className="mtd-preview-panel">
            <MobilePreviewPanel
              kind={preview.kind}
              deviceName={preview.device.name}
              platform={preview.device.platform}
              serial={preview.device.serial ?? undefined}
              sessionState={previewSessionState}
              sessionError={session.state.kind === 'error' ? session.state.message : undefined}
              pendingExecute={preview.pendingExecute}
              onFrame={session.onFrame}
              onScrcpyEvent={session.onScrcpyEvent}
              scrcpyState={scrcpy.state}
              scrcpyStatus={scrcpyStatus}
              scrcpyMetadata={scrcpyMetadata}
              scrcpyRenderedFrames={scrcpy.renderedFrames}
              scrcpyDroppedFrames={scrcpy.droppedFrames}
              scrcpyError={scrcpyError}
              frameCount={frameCount}
              imgRef={imgRef}
              canvasRef={canvasRef}
              onClose={closePreview}
            />
          </div>
        )}
      </div>

      {/* 2026-06-09: 设备选择 modal */}
      <DevicePickerModal
        open={devicePickerOpen}
        testType="mobile"
        expectedPlatform={platform === 'ios' ? 'ios' : 'android'}
        onClose={() => setDevicePickerOpen(false)}
        onLocalExecute={handleLocalExecute}
        onSelect={handleDeviceSelected}
      />
    </div>
  );
}
