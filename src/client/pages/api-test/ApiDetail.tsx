import { useState, useEffect, Fragment, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import FormSelect from '../../components/FormSelect';
import { javascript } from '@codemirror/lang-javascript';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { apiFetch } from '../../utils/api';
import { toLocalDateTime } from '../../utils/datetime';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import VarHoverTip from '../../components/VarHoverTip';
import CodeMirrorHover from '../../components/CodeMirrorHover';
import notification from '../../utils/notification';
import SelectFunctionModal from '../../components/SelectFunctionModal';
import type { ApiItem, ApiLog, AssertionRule, AssertionResult, DatabaseEntry, ApiExecution, ApiExecutionStep, SslCertEntry } from '../../types';
import { PrePostActionList, defaultAction, type PrePostAction } from '../../components/PrePostActionItem';
import ApiExecutionTimeline from '../../components/ApiExecutionTimeline';
import BatchExecutionView from './BatchExecutionView';
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
  { value: 'vars', label: '变量' },
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
  { key: 'params', label: '参数化' },
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
  // Route /api-test/case/new has no :id param, so id is undefined
  // Route /api-test/case/:id has id param (string)
  const isNew = !id || id === 'new';
  // For new pages, set api immediately to avoid "loading" state
  const [api, setApi] = useState<ApiItem | null>(null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [executing, setExecuting] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [error, setError] = useState('');
  const autoExecRef = useRef(false);
  const realIdRef = useRef<string | null>(isNew ? null : id!);
  const dirtyRef = useRef(false);
  const [activeTab, setActiveTab] = useState('detail');
  const [fnModalOpen, setFnModalOpen] = useState(false);
  const [fnTarget, setFnTarget] = useState<'pre_script' | 'post_script' | null>(null);
  // New execution state
  const [executions, setExecutions] = useState<ApiExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<ApiExecution | null>(null);
  // When jumping to a specific execution, track which member tab to show by default
  const [jumpMemberIndex, setJumpMemberIndex] = useState(0);
  // Execution history pagination (15 rows per page)
  const [execPage, setExecPage] = useState(1);
  const EXEC_PAGE_SIZE = 15;

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
    pre_actions: '[]',
    post_actions: '[]',
    parameters: '',
    ssl_cert_name: '',
  });
  const [mainRules, setMainRules] = useState<AssertionRule[]>([]);
  const [preExtractionRules, setPreExtractionRules] = useState<AssertionRule[]>([]);
  const [preAssertionRules, setPreAssertionRules] = useState<AssertionRule[]>([]);
  const [postExtractionRules, setPostExtractionRules] = useState<AssertionRule[]>([]);
  const [postAssertionRules, setPostAssertionRules] = useState<AssertionRule[]>([]);
  // ─── Param Tab state ───
  const [paramConfig, setParamConfig] = useState<{
    enabled: boolean;    // 全局开关
    headers: string[];
    rows: string[][];
    enabledRows: boolean[];  // 每行是否启用
  }>({ enabled: false, headers: [], rows: [], enabledRows: [] });
  const [mainEditingRuleIdx, setMainEditingRuleIdx] = useState<number | null>(null);
  // 前置动作规则编辑状态
  const [preEditingRuleIdx, setPreEditingRuleIdx] = useState<number | null>(null);
  // 后置动作规则编辑状态
  const [postEditingRuleIdx, setPostEditingRuleIdx] = useState<number | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');

  // Initialize api state for new pages immediately
  useEffect(() => {
    if (isNew) {
      setApi({
        id: 0, user_id: 0, name: '', method: 'GET', url: '', protocol: 'https',
        headers: '', body: '', description: '', tags: '', status: 'draft',
        content_type: 'json', assertions: '[]',
        created_at: '', updated_at: '',
      });
    }
  }, [isNew]);

  const ensureCreated = async (): Promise<string | null> => {
    if (realIdRef.current) return realIdRef.current;
    try {
      const payload = { ...form,
        assertions: JSON.stringify(mainRules),
        pre_assertions: JSON.stringify([...preExtractionRules, ...preAssertionRules]),
        post_assertions: JSON.stringify([...postExtractionRules, ...postAssertionRules]),
        pre_actions: JSON.stringify(preActions),
        post_actions: JSON.stringify(postActions),
      };
      const res = await apiFetch<{ id: number }>('/apis', { method: 'POST', body: JSON.stringify(payload) }) as { code: number; message?: string; data?: { id: number } };
      if (res.code === 201 && res.data) {
        realIdRef.current = String(res.data.id);
        navigate(`/api-test/case/${res.data.id}`, { replace: true });
        setApi(prev => prev ? { ...prev, id: res.data!.id } : prev);
        return realIdRef.current;
      }
      notification.error(res.message || '创建失败');
      return null;
    } catch (err) {
      notification.error(err instanceof Error ? err.message : '创建失败');
      return null;
    }
  };

  const { activeEnv } = useEnvironment();

  const handleExecute = async () => {
    if (!realIdRef.current) { notification.warning('请先保存案例后再执行'); return; }
    setExecuting(true);
    try {
      await apiFetch<ApiLog>(`/apis/${realIdRef.current}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) });
      const execRes = await apiFetch<ApiExecution[]>(`/apis/${realIdRef.current}/executions`) as { code: number; data?: ApiExecution[] };
      if (execRes.code === 200 && execRes.data && execRes.data.length > 0) {
        const firstExec = execRes.data[0];
        setExecutions(execRes.data);

        // Check if it's a batch execution - batch leader has sub_executions
        const isBatch = firstExec.sub_executions && firstExec.sub_executions.length > 0;

        if (isBatch) {
          // Fetch details for batch leader and all sub executions
          const [leaderDetail, ...subDetails] = await Promise.all([
            apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${realIdRef.current}/executions/${firstExec.id}`),
            ...firstExec.sub_executions!.map(sub =>
              apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${realIdRef.current}/executions/${sub.id}`)
            )
          ]);
          const subsWithDetails = subDetails.map(r => r.data).filter(Boolean) as ApiExecution[];
          const batchWithDetails = { ...(leaderDetail.data || firstExec), sub_executions: subsWithDetails };
          setSelectedExecution(batchWithDetails);
          setExecutions(prev => prev.map(e => e.id === firstExec.id ? batchWithDetails : e));
        } else {
          // 自动获取最新一条记录的详情
          if (!firstExec.steps) {
            const detailRes = await apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${realIdRef.current}/executions/${firstExec.id}`) as { code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } };
            if (detailRes.code === 200 && detailRes.data) {
              setExecutions(prev => prev.map(e => e.id === firstExec.id ? detailRes.data! : e));
              setSelectedExecution(detailRes.data!);
            }
          } else {
            setSelectedExecution(firstExec);
          }
        }
      }
      setActiveTab('logs');
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
          pre_actions: d.pre_actions || '[]',
          post_actions: d.post_actions || '[]',
          parameters: d.parameters || '',
          ssl_cert_name: d.ssl_cert_name || '',
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
        // 前后置动作列表（组件化格式）
        try { setPreActions(JSON.parse(d.pre_actions || '[]')); } catch { setPreActions([]); }
        try { setPostActions(JSON.parse(d.post_actions || '[]')); } catch { setPostActions([]); }
        // 参数化配置
        try {
          const params = typeof d.parameters === 'string' ? JSON.parse(d.parameters) : d.parameters;
          if (params && typeof params === 'object') {
            setParamConfig({
              enabled: params.enabled || false,
              headers: params.headers || [],
              rows: params.rows || [],
              enabledRows: params.enabledRows || params.rows?.map(() => true) || [],
            });
          }
        } catch { setParamConfig({ enabled: false, headers: [], rows: [], enabledRows: [] }); }
        if (searchParams.get('exec') === '1' && !autoExecRef.current) { autoExecRef.current = true; handleExecute(); }
      }
    });
    apiFetch<ApiLog[]>(`/apis/${id}/logs`).then((res) => { const r = res as { code: number; data?: ApiLog[] }; if (r.code === 200 && r.data) setLogs(r.data); });
    apiFetch<ApiExecution[]>(`/apis/${id}/executions`).then(async (res) => {
      const r = res as { code: number; data?: ApiExecution[] };
      if (r.code === 200 && r.data && r.data.length > 0) {
        setExecutions(r.data);
        const execParam = searchParams.get('exec');
        const paramRowParam = searchParams.get('paramRow');
        if (execParam === '1') {
          // auto execute
          autoExecRef.current = true;
          handleExecute();
        } else if (execParam && !isNaN(Number(execParam))) {
          // jump to specific execution id
          const targetId = Number(execParam);
          const targetExec = r.data.find(e => e.id === targetId || e.sub_executions?.some((s: ApiExecution) => s.id === targetId));
          if (targetExec) {
            const isBatch = targetExec.sub_executions && targetExec.sub_executions.length > 0;
            if (isBatch) {
              // Fetch leader + all sub execution details for batch
              const [leaderDetail, ...subDetails] = await Promise.all([
                apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${targetExec.id}`) as Promise<{ code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } }>,
                ...targetExec.sub_executions!.map(sub =>
                  apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${sub.id}`) as Promise<{ code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } }>
                )
              ]);
              const subsWithDetails = subDetails.map(r => r.data).filter(Boolean) as ApiExecution[];
              const batchWithDetails = { ...(leaderDetail.data || targetExec), sub_executions: subsWithDetails };
              // Calculate correct tab index: allRows = [leader, ...subs] sorted by param_row_index
              const allRows = [batchWithDetails, ...subsWithDetails].sort((a, b) => a.param_row_index - b.param_row_index);
              let memberIdx = 0;
              if (paramRowParam != null) {
                memberIdx = allRows.findIndex(r => r.param_row_index === Number(paramRowParam));
                if (memberIdx < 0) memberIdx = 0;
              } else {
                memberIdx = allRows.findIndex(r => r.id === targetId);
                if (memberIdx < 0) memberIdx = 0;
              }
              setJumpMemberIndex(memberIdx);
              setExecutions(prev => prev.map(e => e.id === targetExec.id ? batchWithDetails : e));
              setSelectedExecution(batchWithDetails);
              setExpandedLog(targetExec.id);
              setActiveTab('logs');
            } else {
              // Single execution (no batch)
              apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${targetExec.id}`).then((detailRes) => {
                const detail = detailRes as unknown as { code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } };
                if (detail.code === 200 && detail.data) {
                  setExecutions(prev => prev.map(e => e.id === targetExec.id ? detail.data! : e));
                  setSelectedExecution(detail.data!);
                  setExpandedLog(targetExec.id);
                  setActiveTab('logs');
                }
              });
            }
          }
        } else {
          // normal: select first execution
          setJumpMemberIndex(0);
          const firstExec = r.data[0];
          if (!firstExec.steps) {
            apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${firstExec.id}`).then((detailRes) => {
              const detail = detailRes as unknown as { code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } };
              if (detail.code === 200 && detail.data) {
                setExecutions(prev => prev.map(e => e.id === firstExec.id ? detail.data! : e));
                setSelectedExecution(detail.data!);
              }
            });
          } else {
            setSelectedExecution(firstExec);
          }
        }
      }
    });
  }, [id]);

  const handleSelectExecution = useCallback(async (exec: ApiExecution) => {
    if (selectedExecution?.id === exec.id) {
      setSelectedExecution(null);
    } else {
      const isBatch = exec.sub_executions && exec.sub_executions.length > 0;
      if (isBatch) {
        // Fetch details for batch leader and all sub executions
        const [leaderDetail, ...subDetails] = await Promise.all([
          apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${exec.id}`),
          ...exec.sub_executions!.map(sub =>
            apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${sub.id}`)
          )
        ]);
        const subsWithDetails = subDetails.map(r => r.data).filter(Boolean) as ApiExecution[];
        const batchWithDetails = { ...(leaderDetail.data || exec), sub_executions: subsWithDetails };
        setSelectedExecution(batchWithDetails);
        setExecutions(prev => prev.map(e => e.id === exec.id ? batchWithDetails : e));
      } else {
        setSelectedExecution(exec);
        if (!exec.steps) {
          apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${id}/executions/${exec.id}`).then((res) => {
            const r = res as unknown as { code: number; data?: ApiExecution & { steps: ApiExecutionStep[] } };
            if (r.code === 200 && r.data) {
              setExecutions(prev => prev.map(e => e.id === exec.id ? r.data! : e));
              setSelectedExecution(r.data!);
            }
          });
        }
      }
    }
  }, [id, selectedExecution?.id]);

  

  const handleSave = async () => {
    setError('');
    // 必填字段校验
    if (!form.name.trim()) {
      notification.warning('请输入接口名称');
      setActiveTab('detail');
      return;
    }
    if (!form.url.trim()) {
      notification.warning('请输入请求地址');
      setActiveTab('main');
      return;
    }
    const rid = await ensureCreated(); if (!rid) return;
    try {
      const payload = { ...form,
        assertions: JSON.stringify(mainRules),
        pre_assertions: JSON.stringify([...preExtractionRules, ...preAssertionRules]),
        post_assertions: JSON.stringify([...postExtractionRules, ...postAssertionRules]),
        pre_actions: JSON.stringify(preActions),
        post_actions: JSON.stringify(postActions),
        parameters: JSON.stringify({ enabled: paramConfig.enabled, headers: paramConfig.headers, rows: paramConfig.rows, enabledRows: paramConfig.enabledRows }),
      };
      const res = await apiFetch(`/apis/${rid}`, { method: 'PUT', body: JSON.stringify(payload) }) as { code: number; message?: string };
      if (res.code !== 200) { notification.error(res.message || '保存失败'); return; }
      setApi({ ...api!, ...payload, updated_at: new Date().toISOString() } as ApiItem);
      dirtyRef.current = false;
      notification.success('保存成功');
    } catch (err) { notification.error(err instanceof Error ? err.message : '保存失败'); }
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
          <FormSelect value={rule.source} options={ASSERTION_SOURCES} onChange={(v) => onUpdate(idx, 'source', v)} size="compact" />
          <input className="rule-key" placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : rule.source === 'vars' ? '变量名' : '路径如 data.id'} value={rule.key} onChange={(e) => onUpdate(idx, 'key', e.target.value)} disabled={rule.source === 'status'} />
          {mode === 'assert' && (
            <>
              {/* 校验开关：打开显示"检查"+下拉+输入框，关闭显示"提取"+隐藏下拉和输入框 */}
              <label className="rule-switch rule-switch--labeled">
                <input type="checkbox" checked={rule.assert !== false} onChange={() => { onUpdate(idx, 'assert', rule.assert === false); }} />
                <span className="rule-switch-slider"><span className="rule-switch-label">{rule.assert !== false ? '检查' : '提取'}</span></span>
              </label>
              <FormSelect className="rule-operator" value={rule.operator} options={ASSERTION_OPERATORS} onChange={(v) => onUpdate(idx, 'operator', v)} size="compact" style={{ display: rule.assert === false ? 'none' : undefined }} />
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
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="api-detail-row">
          <div className="field"><label>接口名称 <span className="required">*</span></label><InlineText value={form.name} onChange={v => { setForm(f => ({ ...f, name: v })); dirtyRef.current = true; }} placeholder="点击输入接口名称" /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>描述</label><InlineText value={form.description} onChange={v => { setForm(f => ({ ...f, description: v })); dirtyRef.current = true; }} placeholder="点击输入描述" multiline /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>标签</label><TagInput value={form.tags} onChange={v => { setForm(f => ({ ...f, tags: v })); dirtyRef.current = true; }} onDirty={() => { dirtyRef.current = true; }} placeholder="输入标签，回车确认" /></div>
          <div className="field"><label>状态</label><InlineSelect value={form.status} options={STATUS_OPTIONS} onChange={v => { setForm(f => ({ ...f, status: v })); dirtyRef.current = true; }} renderDisplay={(v, label) => <span className={`status-text status-${v}`}>{label}</span>} /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>创建时间</label><span className="field-value">{toLocalDateTime(api.created_at)}</span></div>
          <div className="field"><label>更新时间</label><span className="field-value">{toLocalDateTime(api.updated_at)}</span></div>
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
        {form.protocol === 'https' && (() => {
          const certOptions: Array<{ value: string; label: string }> = [{ value: '', label: '请选择' }];
          if (activeEnv?.ssl_certs) {
            try {
              const certs: SslCertEntry[] = JSON.parse(activeEnv.ssl_certs);
              if (Array.isArray(certs)) {
                for (const c of certs) {
                  if (c.cert) certOptions.push({ value: c.name, label: c.name || '未命名证书' });
                }
              }
            } catch { /* ignore */ }
          }
          return (
            <div className="api-detail-row">
              <div className="field">
                <label>SSL 证书</label>
                <InlineSelect
                  value={form.ssl_cert_name}
                  options={certOptions}
                  onChange={v => { setForm(f => ({ ...f, ssl_cert_name: v })); dirtyRef.current = true; }}
                />
              </div>
            </div>
          );
        })()}
        <div className="api-detail-row">
          <div className="field field-url"><label>请求地址 <span className="required">*</span></label>
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
          <CodeMirrorHover value={form.headers} height="120px" extensions={[json(), linter(jsonParseLinter())]} onChange={(val) => { setForm({ ...form, headers: val }); dirtyRef.current = true; }} placeholder={HEADER_HINT} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }} />
        </div>
        <div className="api-detail-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>报文类型</label>
            <div className="ad-ct-row">
              {CONTENT_TYPES.map((ct) => (<button key={ct.value} type="button" className={`ad-ct-btn ${form.content_type === ct.value ? 'active' : ''}`} onClick={() => { setForm({ ...form, content_type: ct.value }); dirtyRef.current = true; }}>{ct.label}</button>))}
            </div>
          </div>
        </div>
        <div className="ad-editor-section">
          <div className="ad-editor-label"><label>请求体</label><button type="button" className="ad-btn ad-btn-sm" onClick={() => handleFormat('body')}>格式化</button></div>
          <CodeMirrorHover value={form.body} height="200px" extensions={getEditorLang(form.content_type) || []} onChange={(val) => { setForm({ ...form, body: val }); dirtyRef.current = true; }} placeholder={BODY_HINTS[form.content_type]} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }} />
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
                <FormSelect value={rule.source} options={ASSERTION_SOURCES} onChange={(v) => updateMainRule(idx, 'source', v)} size="compact" />
                <input className="rule-key" placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'} value={rule.key} onChange={(e) => updateMainRule(idx, 'key', e.target.value)} disabled={rule.source === 'status'} />
                {/* 校验开关：开关控制后面operator和expected的显示，关闭时清空值 */}
                <label className="rule-switch rule-switch--labeled">
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
                    <FormSelect value={rule.operator} options={ASSERTION_OPERATORS} onChange={(v) => updateMainRule(idx, 'operator', v)} size="compact" />
                    {!['exists', 'not_exists'].includes(rule.operator) && (<input className="rule-expected" placeholder="期望值" value={rule.expected} onChange={(e) => updateMainRule(idx, 'expected', e.target.value)} />)}
                  </>
                )}
                <button type="button" className="rule-del" onClick={() => removeMainRule(idx)}>✕</button>
              </div>
            ))}
            {mainRules.length === 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-tertiary)', marginBottom: 8 }}>暂无提取和断言规则</div>
            )}
          </div>
          <button type="button" className="ad-btn ad-btn-sm" onClick={() => { addMainRule(); dirtyRef.current = true; }}>+ 添加规则</button>
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

  // ─── Tab: Params ───
  const renderParamsTab = () => {
    // 全局开关切换
    const toggleEnabled = () => {
      setParamConfig(p => ({ ...p, enabled: !p.enabled }));
      dirtyRef.current = true;
    };

    // 添加新列
    const addColumn = () => {
      setParamConfig(p => ({
        ...p,
        headers: [...p.headers, `col${p.headers.length + 1}`],
        rows: p.rows.map(row => [...row, '']),
        enabledRows: p.enabledRows.length < p.rows.length
          ? [...p.enabledRows, ...new Array(p.rows.length - p.enabledRows.length).fill(true)]
          : p.enabledRows,
      }));
      dirtyRef.current = true;
    };
    // 删除列
    const removeColumn = (colIdx: number) => {
      setParamConfig(p => ({
        ...p,
        headers: p.headers.filter((_, i) => i !== colIdx),
        rows: p.rows.map(row => row.filter((_, i) => i !== colIdx)),
      }));
      dirtyRef.current = true;
    };
    // 添加行
    const addRow = () => {
      setParamConfig(p => ({
        ...p,
        rows: [...p.rows, new Array(p.headers.length).fill('')],
        enabledRows: [...p.enabledRows, true],
      }));
      dirtyRef.current = true;
    };
    // 删除行
    const removeRow = (rowIdx: number) => {
      setParamConfig(p => ({
        ...p,
        rows: p.rows.filter((_, i) => i !== rowIdx),
        enabledRows: p.enabledRows.filter((_, i) => i !== rowIdx),
      }));
      dirtyRef.current = true;
    };
    // 切换行启用状态
    const toggleRowEnabled = (rowIdx: number) => {
      setParamConfig(p => {
        const enabledRows = [...p.enabledRows];
        enabledRows[rowIdx] = !enabledRows[rowIdx];
        return { ...p, enabledRows };
      });
      dirtyRef.current = true;
    };
    // 全选 / 全不选
    const toggleAllRows = (checked: boolean) => {
      setParamConfig(p => ({
        ...p,
        enabledRows: p.rows.map(() => checked),
      }));
      dirtyRef.current = true;
    };
    // 修改列头
    const setHeader = (colIdx: number, val: string) => {
      setParamConfig(p => {
        const headers = [...p.headers];
        headers[colIdx] = val;
        return { ...p, headers };
      });
      dirtyRef.current = true;
    };
    // 修改单元格
    const setCell = (rowIdx: number, colIdx: number, val: string) => {
      setParamConfig(p => {
        const rows = p.rows.map((row, ri) => ri === rowIdx ? row.map((cell, ci) => ci === colIdx ? val : cell) : row);
        return { ...p, rows };
      });
      dirtyRef.current = true;
    };

    // CSV 上传 + 与现有数据合并
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const lines = text.trim().split('\n');
        if (lines.length < 2) { notification.warning('CSV 至少需要一行表头和一行数据'); return; }
        const csvHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const csvRows = lines.slice(1).map(line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));

        setParamConfig(p => {
          // 合并列头（去重追加）
          const allHeaders = [...p.headers];
          const existingSet = new Set(p.headers.map(h => h.toLowerCase()));
          for (const h of csvHeaders) {
            if (h && !existingSet.has(h.toLowerCase())) { allHeaders.push(h); existingSet.add(h.toLowerCase()); }
          }
          // 建立 header → column index 映射
          const headerIdx = new Map<string, number>();
          allHeaders.forEach((h, i) => headerIdx.set(h.toLowerCase(), i));
          for (const h of csvHeaders) { if (h) headerIdx.set(h.toLowerCase(), allHeaders.indexOf(h)); }
          // 构建合并后的行：取行数较多者
          const maxRows = Math.max(p.rows.length, csvRows.length);
          const mergedRows: string[][] = [];
          const mergedEnabled: boolean[] = [];
          for (let i = 0; i < maxRows; i++) {
            const row = new Array(allHeaders.length).fill('');
            if (i < p.rows.length) {
              p.rows[i].forEach((val, ci) => { if (ci < allHeaders.length) row[ci] = val; });
            }
            if (i < csvRows.length) {
              csvRows[i].forEach((val, ci) => {
                const h = csvHeaders[ci];
                if (h) {
                  const idx = allHeaders.indexOf(h);
                  if (idx !== -1) row[idx] = val;
                }
              });
            }
            mergedRows.push(row);
            mergedEnabled.push(i < p.enabledRows.length ? p.enabledRows[i] : true);
          }
          for (let i = p.enabledRows.length; i < maxRows; i++) mergedEnabled[i] = true;
          return { ...p, headers: allHeaders, rows: mergedRows, enabledRows: mergedEnabled };
        });
        dirtyRef.current = true;
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    // 下载模板
    const downloadTemplate = () => {
      const headers = paramConfig.headers.length > 0 ? paramConfig.headers : ['var1', 'var2'];
      const sampleRow = headers.map(() => 'value');
      const csv = [headers.join(','), sampleRow.join(',')].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'template.csv'; a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="tab-content-wrapper">
        <div className="ad-section">
          {/* 全局启用开关 */}
          <div className="param-enable-row">
            <label className="rule-switch rule-switch--labeled">
              <input type="checkbox" checked={paramConfig.enabled} onChange={toggleEnabled} />
              <span className="rule-switch-slider">
                <span className="rule-switch-label">{paramConfig.enabled ? '已启用' : '已禁用'}</span>
              </span>
            </label>
          </div>

          <div className="param-table-wrapper">
            <div className="param-action-row">
              <button type="button" className="ad-btn ad-btn-sm" onClick={addColumn}>添加列</button>
              <button type="button" className="ad-btn ad-btn-sm" onClick={addRow}>添加行</button>
              <label className="scenario-btn">
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} />
                上传 CSV
              </label>
              <button type="button" className="scenario-btn" onClick={downloadTemplate}>下载模板</button>
            </div>

            {paramConfig.headers.length === 0 ? (
              <div className="param-empty-hint">点击「添加列」或「上传 CSV」开始配置参数</div>
            ) : (
              <table className="param-table">
                <thead>
                  <tr>
                    <th className="param-th-check">
                      {paramConfig.rows.length > 0 && (
                        <input
                          type="checkbox"
                          title="全选 / 全不选"
                          checked={paramConfig.rows.every((_, i) => paramConfig.enabledRows[i] !== false)}
                          onChange={e => toggleAllRows(e.target.checked)}
                        />
                      )}
                    </th>
                    {paramConfig.headers.map((h, ci) => (
                      <th key={ci}>
                        <input className="param-header-input" value={h} onChange={e => setHeader(ci, e.target.value)} placeholder="变量名" />
                        <button className="param-col-del" onClick={() => removeColumn(ci)} title="删除此列">✕</button>
                      </th>
                    ))}
                    <th className="param-th-del"></th>
                  </tr>
                </thead>
                <tbody>
                  {paramConfig.rows.length === 0 ? (
                    <tr><td colSpan={paramConfig.headers.length + 2} className="param-empty-row">暂无数据，点击「添加行」创建</td></tr>
                  ) : paramConfig.rows.map((row, ri) => (
                    <tr key={ri} className={paramConfig.enabledRows[ri] ? '' : 'param-row-disabled'}>
                      <td>
                        <label className="param-row-check">
                          <input type="checkbox" checked={paramConfig.enabledRows[ri] !== false} onChange={() => toggleRowEnabled(ri)} />
                        </label>
                      </td>
                      {paramConfig.headers.map((_, ci) => (
                        <td key={ci}>
                          <input
                            className="param-cell-input"
                            value={row[ci] ?? ''}
                            onChange={e => setCell(ri, ci, e.target.value)}
                          />
                        </td>
                      ))}
                      <td><button className="param-row-del" onClick={() => removeRow(ri)} title="删除此行">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {paramConfig.headers.length > 0 && (
            <div className="param-usage-hint">
              <div className="param-usage-title">使用方式：</div>
              <div>在请求地址、请求头、请求体中使用 <code>{"{{变量名}}"}</code> 引用参数</div>
              <div>例如：<code>{"{{user}}"}</code> 会替换为当前行的变量值</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Tab: Logs ───
  const renderLogsTab = () => {
    const totalExecPages = Math.max(1, Math.ceil(executions.length / EXEC_PAGE_SIZE));
    const pagedExecs = executions.slice((execPage - 1) * EXEC_PAGE_SIZE, execPage * EXEC_PAGE_SIZE);
    return (
      <div className="tab-content-wrapper">
        <div className="ad-section">
          <div className="ad-section-head">
            <label>执行历史</label>
            {executions.length > EXEC_PAGE_SIZE && (
              <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>共 {executions.length} 条</span>
            )}
          </div>
          {executions.length === 0 ? (<div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>) : (
            <>
              <table className="log-table">
                <thead><tr><th>时间</th><th>状态</th><th>耗时</th><th>执行人</th><th>操作</th></tr></thead>
                <tbody>{pagedExecs.map((exec) => {
                  const isSelected = selectedExecution?.id === exec.id;
                  const isBatch = exec.sub_executions && exec.sub_executions.length > 0;
                  return (
                    <Fragment key={exec.id}>
                      <tr className={isSelected ? 'log-row-selected' : ''}>
                        <td>{toLocalDateTime(exec.started_at)}</td>
                        <td><span className={`status-badge ${exec.status === 'success' ? 'success' : exec.status === 'failed' ? 'failed' : 'error'}`}>{exec.status}</span>{isBatch && <span className="batch-badge">({exec.sub_executions!.length + 1}组)</span>}</td>
                        <td>{exec.duration_ms != null ? `${exec.duration_ms} ms` : '-'}</td>
                        <td>{exec.executed_by || '-'}</td>
                        <td><button className="log-view-btn" onClick={() => handleSelectExecution(exec)}>{isSelected ? '收起' : '查看'}</button></td>
                      </tr>
                      {isSelected && (
                        <tr className="log-detail-row">
                          <td colSpan={5}>
                            {isBatch ? (
                              <BatchExecutionView execution={selectedExecution} id={id!} defaultActiveRow={jumpMemberIndex} />
                            ) : (
                              <ApiExecutionTimeline
                                execution={selectedExecution}
                                steps={selectedExecution.steps || []}
                                assertionResults={{ pre: [], main: [], post: [], final: [] }}
                              />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}</tbody>
              </table>
              {totalExecPages > 1 && (
                <div className="log-pagination">
                  <button className="btn btn-sm btn-ghost" disabled={execPage <= 1} onClick={() => setExecPage(p => p - 1)}>上一页</button>
                  <span className="log-pagination-info">{execPage} / {totalExecPages}</span>
                  <button className="btn btn-sm btn-ghost" disabled={execPage >= totalExecPages} onClick={() => setExecPage(p => p + 1)}>下一页</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="api-detail page-enter">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate('/api-test/case')}>用例列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); dirtyRef.current = true; }} placeholder="输入接口名称" />
        </div>
        <div className="api-detail-meta">
          {!isNew && api && <span className={`status-badge-light ${form.status}`}>{STATUS_OPTIONS.find(o => o.value === form.status)?.label || form.status}</span>}
          {api?.updated_at && <span className="meta-time">更新于 {toLocalDateTime(api.updated_at)}</span>}
        </div>
        <div className="api-detail-actions">
          <button className="scenario-btn" onClick={handleSave}>保存</button>
          <button className={`sset-btn sset-btn-primary${!realIdRef.current ? ' scenario-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>{executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}</button>
        </div>
      </div>
      <div className="api-detail-content">
        <div className="api-detail-card" style={{ padding: 0 }}>
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'pre' && renderPreTab()}
            {activeTab === 'main' && renderMainTab()}
            {activeTab === 'post' && renderPostTab()}
            {activeTab === 'params' && renderParamsTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
        </div>
      </div>
      {error && <div className="api-error">{error}</div>}
      <SelectFunctionModal
        open={fnModalOpen}
        onClose={() => setFnModalOpen(false)}
        onInsert={handleInsertFunction}
      />
    </div>
  );
}
