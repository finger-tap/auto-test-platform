import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiFetch } from '../../utils/api';
import { toLocalDateTime } from '../../utils/datetime';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import TagInput from '../../components/TagInput';
import notification from '../../utils/notification';
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioLog, ApiItem, ApiNodeConfig, NodeExecutionResult, AssertionRule, ScenarioExecution, ScenarioExecutionStep } from '../../types';
import type { AvailableVar } from './NodeConfigPanel';
import StartNode from './nodes/StartNode';
import ApiNode from './nodes/ApiNode';
import ConditionNode from './nodes/ConditionNode';
import EndNode from './nodes/EndNode';
import NodeConfigPanel from './NodeConfigPanel';
import ExecutionResultPanel from './ExecutionResultPanel';
import ScenarioExecutionTimeline from '../../components/ScenarioExecutionTimeline';
import ScenarioBatchExecutionView from './ScenarioBatchExecutionView';
import './nodes/NodeStyles.css';
import './ScenarioDetail.css';

const nodeTypes: NodeTypes = {
  start: StartNode,
  api: ApiNode,
  condition: ConditionNode,
  end: EndNode,
};

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

// 根据测试类型映射到对应的 API 路径
const API_PATH_MAP: Record<string, { list: string; detail: string; create: string; delete: string }> = {
  api: { list: '/scenarios', detail: '/scenarios', create: '/scenarios', delete: '/scenarios' },
  web: { list: '/scenarios-web', detail: '/scenarios-web', create: '/scenarios-web', delete: '/scenarios-web' },
  pc: { list: '/scenarios-pc', detail: '/scenarios-pc', create: '/scenarios-pc', delete: '/scenarios-pc' },
  mobile: { list: '/scenarios-mobile', detail: '/scenarios-mobile', create: '/scenarios-mobile', delete: '/scenarios-mobile' },
};

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'flow', label: '流程图' },
  { key: 'params', label: '参数化' },
  { key: 'logs', label: '执行记录' },
];

export default function ScenarioDetail({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  const { activeEnv } = useEnvironment();
  const [scenario, setScenario] = useState<Scenario | null>(isNew ? {
    id: 0, user_id: 0, name: '', description: '', tags: '', status: 'draft',
    created_at: '', updated_at: '',
  } as Scenario : null);
  // 新建场景时默认有开始和结束节点
  const initialNodes: Node[] = isNew ? [
    { id: 'start-1', type: 'start', position: { x: 250, y: 50 }, data: { label: '开始' } },
    { id: 'end-1', type: 'end', position: { x: 250, y: 300 }, data: { label: '结束' } },
  ] : [];
  const initialEdges: Edge[] = isNew ? [
    { id: 'e-start-end', source: 'start-1', target: 'end-1', type: 'smoothstep' },
  ] : [];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ScenarioLog | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [activeParamRow, setActiveParamRow] = useState<number>(0); // Active param row tab in logs
  const [logs, setLogs] = useState<ScenarioLog[]>([]);
  const [scenarioExecutions, setScenarioExecutions] = useState<ScenarioExecution[]>([]);
  const [selectedScenarioExecution, setSelectedScenarioExecution] = useState<ScenarioExecution | null>(null);
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [saving, setSaving] = useState(false);
  const autoExecRef = useRef(false);
  const realIdRef = useRef<string | null>(isNew ? null : id!);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'detail');
  // 场景级参数化配置
  const [paramConfig, setParamConfig] = useState<{
    headers: string[];
    rows: string[][];
    enabledRows: boolean[];
  }>({ headers: [], rows: [], enabledRows: [] });

  // ── Find all upstream nodes by following edges in reverse ──
  // Returns all nodes that have a path TO the target node (i.e. execute before it)
  const getUpstreamNodes = useCallback((
    targetNodeId: string,
    ns: Node[],
    es: Edge[]
  ): Node[] => {
    // Build reverse adjacency: nodeId → [nodes that point TO this node]
    const revAdj = new Map<string, string[]>();
    ns.forEach((n) => revAdj.set(n.id, []));
    es.forEach((e) => {
      if (revAdj.has(e.source) && revAdj.has(e.target)) {
        revAdj.get(e.target)!.push(e.source);
      }
    });

    const visited = new Set<string>();
    const result: Node[] = [];
    const queue: string[] = [targetNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Find all nodes that point to current (reverse direction = upstream)
      const predecessors = revAdj.get(current) || [];
      for (const predId of predecessors) {
        if (!visited.has(predId)) {
          const predNode = ns.find((n) => n.id === predId);
          if (predNode) {
            result.push(predNode);
            queue.push(predId);
          }
        }
      }
    }

    return result; // All ancestors (excluding the target itself)
  }, []);

  // ── Extract parameter columns from flow nodes ──
  const extractColumnsFromNodes = (allNodes: Node[]) => {
    const seen = new Set<string>();
    const columns: string[] = [];
    for (const n of allNodes) {
      if (n.type === 'api') {
        const config = n.data as unknown as ApiNodeConfig;
        const rules = config.extractions || config.extract_rules || [];
        rules.forEach((rule) => {
          if (rule.var_name && !seen.has(rule.var_name)) {
            seen.add(rule.var_name);
            columns.push(rule.var_name);
          }
        });
      }
    }
    return { headers: columns, rows: [], enabledRows: [] };
  };

  // ── Collect all extraction variables from an API item (all stages) ──
  // Gathers from: pre-actions + main assertions + post-actions + final assertions (where assert=false)
  const collectApiExtractions = (api: ApiItem): { varName: string; stage: string }[] => {
    const vars: { varName: string; stage: string }[] = [];
    const seen = new Set<string>();

    const addVar = (name: string, stage: string) => {
      if (name && !seen.has(name)) { seen.add(name); vars.push({ varName: name, stage }); }
    };

    const addFromAssertions = (assertionsJson: string | null | undefined, stage: string) => {
      if (!assertionsJson) return;
      try {
        const arr = JSON.parse(assertionsJson);
        if (Array.isArray(arr)) {
          arr.forEach((r: AssertionRule) => {
            if (r.assert === false) {
              if (r.name) addVar(r.name, stage);
              const rAny = r as unknown as Record<string, unknown>;
              if (rAny.var_name) addVar(rAny.var_name as string, stage);
            }
          });
        }
      } catch { /* ignore */ }
    };

    // Main + Pre + Post + Final assertions (assert=false → extraction)
    addFromAssertions(api.assertions, '主体');
    addFromAssertions(api.pre_assertions, '前置');
    addFromAssertions(api.post_assertions, '后置');
    addFromAssertions(api.final_assertions, '最终');

    // Pre/post actions structured format
    const addFromActions = (actionsJson: string | null | undefined, stage: string) => {
      if (!actionsJson) return;
      try {
        const arr = JSON.parse(actionsJson);
        if (Array.isArray(arr)) {
          arr.forEach((action: Record<string, unknown>) => {
            if (Array.isArray(action.assertions)) {
              (action.assertions as AssertionRule[]).forEach((r) => {
                if (r.assert === false) {
                  if (r.name) addVar(r.name, stage);
                  const rAny = r as unknown as Record<string, unknown>;
                  if (rAny.var_name) addVar(rAny.var_name as string, stage);
                }
              });
            }
          });
        }
      } catch { /* ignore */ }
    };

    addFromActions(api.pre_actions, '前置');
    addFromActions(api.post_actions, '后置');

    return vars;
  };

  // ── Compute available variables from all upstream API nodes ──
  const currentNodeAvailableVars = useMemo((): AvailableVar[] => {
    if (!selectedNode) return [];
    const upstream = getUpstreamNodes(selectedNode.id, nodes, edges);
    const result: AvailableVar[] = [];
    const seen = new Set<string>();

    upstream.forEach((n) => {
      if (n.type === 'api') {
        const config = n.data as unknown as ApiNodeConfig;
        const apiName = config.api_name || n.id;

        // 1. Variables from the API case itself (all stages: pre/main/post/final)
        const api = apis.find((a) => a.id === config.api_id);
        if (api) {
          const apiExtractions = collectApiExtractions(api);
          apiExtractions.forEach((v) => {
            if (!seen.has(v.varName)) {
              seen.add(v.varName);
              result.push({ varName: v.varName, sourceNode: n.id, sourceNodeName: `${apiName}(${v.stage})`, stage: v.stage });
            }
          });
        }

        // 2. Variables from the node's own override config
        const rules = config.extractions || config.extract_rules || [];
        rules.forEach((rule) => {
          if (rule.var_name && !seen.has(rule.var_name)) {
            seen.add(rule.var_name);
            result.push({ varName: rule.var_name, sourceNode: n.id, sourceNodeName: `${apiName}(节点补充)`, stage: '节点' });
          }
        });
      }
    });

    return result;
  }, [selectedNode, nodes, edges, apis, getUpstreamNodes]);

  const ensureCreated = async (): Promise<string | null> => {
    if (realIdRef.current) return realIdRef.current;
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    const routeBase = testType === 'api' ? '/api-test/scene' : testType === 'web' ? '/web-test/scene' : testType === 'pc' ? '/pc-test/scene' : '/mobile-test/scene';
    try {
      const res = await apiFetch<{ id: number }>(apiPath.list, {
        method: 'POST',
        body: JSON.stringify({
          name: scenario?.name || '未命名场景',
          description: scenario?.description || '',
          tags: scenario?.tags || '',
          status: scenario?.status || 'draft',
        }),
      });
      if (res.code === 201 && res.data) {
        realIdRef.current = String(res.data.id);
        navigate(`${routeBase}/${res.data.id}`, { replace: true });
        setScenario(prev => prev ? { ...prev, id: res.data!.id } : prev);
        return realIdRef.current;
      }
      return null;
    } catch (err) {
      notification.error(err instanceof Error ? err.message : '创建失败');
      return null;
    }
  };

  useEffect(() => {
    if (!id || isNew) return;
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    apiFetch<{ scenario: Scenario; nodes: ScenarioNode[]; edges: ScenarioEdge[] }>(`${apiPath.detail}/${id}`).then((res) => {
      if (res.code === 200 && res.data) {
        setScenario(res.data.scenario);
        const rfNodes: Node[] = res.data.nodes.map((n) => ({
          id: n.node_id, type: n.type,
          position: { x: n.position_x, y: n.position_y },
          data: n.config ? JSON.parse(n.config) : { label: n.label },
        }));
        setNodes(rfNodes);
        // 如果节点为空，自动补充开始节点
        if (rfNodes.length === 0) {
          setNodes([{ id: 'start-1', type: 'start', position: { x: 250, y: 50 }, data: { label: '开始' } }]);
        }
        const rfEdges: Edge[] = res.data.edges.map((e) => ({
          id: e.edge_id, source: e.source_node_id, target: e.target_node_id,
          sourceHandle: e.source_handle || undefined,
          label: e.label || undefined,
          animated: e.source_handle === 'true' || e.source_handle === 'false',
        }));
        setEdges(rfEdges);
        // 加载参数化配置
        try {
          const rawParams = res.data.scenario.parameters;
          if (rawParams) {
            const parsed = JSON.parse(rawParams);
            setParamConfig({ headers: parsed.headers || [], rows: parsed.rows || [], enabledRows: parsed.enabledRows || [] });
          } else {
            // 自动从节点提取列名
            setParamConfig(extractColumnsFromNodes(rfNodes));
          }
        } catch { setParamConfig({ headers: [], rows: [], enabledRows: [] }); }
      }
    });
    apiFetch<ScenarioLog[]>(`${apiPath.detail}/${id}/logs`).then((res) => {
      if (res.code === 200 && res.data) setLogs(res.data);
    });
    apiFetch<ScenarioExecution[]>(`${apiPath.detail}/${id}/executions`).then((res) => {
      if (res.code === 200 && res.data && res.data.length > 0) {
        setScenarioExecutions(res.data);
        // Fetch steps for leader and all members
        const fetchDetail = (exec: ScenarioExecution): Promise<ScenarioExecution> => {
          return apiFetch<ScenarioExecution & { steps: ScenarioExecutionStep[] }>(`${apiPath.detail}/${id}/executions/${exec.id}`).then((detailRes) => {
            if (detailRes.code === 200 && detailRes.data) {
              return { ...exec, ...detailRes.data };
            }
            return exec;
          });
        };
        // Build updated list with steps for leader + all sub_executions
        Promise.all(res.data.map(async (exec) => {
          const leader = await fetchDetail(exec);
          if (leader.sub_executions && leader.sub_executions.length > 0) {
            const subs = await Promise.all(leader.sub_executions.map(sub => fetchDetail(sub)));
            return { ...leader, sub_executions: subs };
          }
          return leader;
        })).then((updated) => {
          setScenarioExecutions(updated);
          setSelectedScenarioExecution(updated[0] || null);
        });
      }
    });
  }, [id]);

  useEffect(() => {
    apiFetch('/apis').then((res) => {
      if (res.code === 200 && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) setApis(data as ApiItem[]);
        else if (data && typeof data === 'object' && 'items' in data) setApis((data as { items: ApiItem[] }).items);
      }
    });
  }, []);

  useEffect(() => {
    if (searchParams.get('exec') === '1' && !autoExecRef.current && scenario) {
      autoExecRef.current = true;
      handleExecute();
    }
  }, [scenario]);

  const onConnect: OnConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, animated: false }, eds)), [setEdges]);
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const addNode = useCallback((type: string) => {
    const nodeCount = nodes.filter((n) => n.type === type).length;
    const nodeId = `${type}_${Date.now()}`;
    let data: Record<string, unknown> = {};
    switch (type) {
      case 'start': data = { label: '开始' }; break;
      case 'end': data = { label: '结束' }; break;
      case 'api': data = { api_id: 0, api_name: '', extractions: [] } as unknown as Record<string, unknown>; break;
      case 'condition': data = { condition_expr: '' } as unknown as Record<string, unknown>; break;
    }
    // 自动计算位置：找到已有节点的最底部，在其下方添加新节点
    const maxY = nodes.reduce((max, n) => Math.max(max, n.position.y), 0);
    const avgX = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length : 250;
    const nodeWidth = type === 'condition' ? 140 : 120;
    const nodeHeight = 60;
    const gap = 80;
    const position = { x: avgX + (nodeCount % 3) * 50 - nodeWidth / 2, y: maxY + nodeHeight + gap };
    setNodes((nds) => [...nds, { id: nodeId, type, position, data }]);
    setIsDirty(true);
  }, [nodes, setNodes]);

  const updateNodeData = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n));
    setIsDirty(true);
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'start' || nodeId === 'end') return;
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    setIsDirty(true);
  }, [setNodes, setEdges]);

  const saveField = (field: string, value: string) => {
    setScenario((prev) => prev ? { ...prev, [field]: value } : null);
    setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true); let ok = true;
    const rid = await ensureCreated();
    if (!rid) { setSaving(false); return; }
    try {
      const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
      // 1. 保存基本信息（名称/描述/标签/状态/参数化配置）
      const metaRes = await apiFetch(`${apiPath.detail}/${rid}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: scenario?.name || '未命名场景',
          description: scenario?.description || '',
          tags: scenario?.tags || '',
          status: scenario?.status || 'draft',
          parameters: JSON.stringify(paramConfig),
        }),
      });
      if (metaRes.code !== 200) { ok = false; throw new Error(metaRes.message || '保存基本信息失败'); }

      // 2. 保存流程图（节点+连线）
      const dbNodes = nodes.map((n) => ({
        node_id: n.id, type: n.type || 'api',
        position_x: n.position.x, position_y: n.position.y,
        label: (n.data as Record<string, unknown>).label as string || null,
        config: JSON.stringify(n.data),
      }));
      const dbEdges = edges.map((e) => ({
        edge_id: e.id, source_node_id: e.source, target_node_id: e.target,
        source_handle: e.sourceHandle || null, label: typeof e.label === 'string' ? e.label : null,
      }));
      const flowRes = await apiFetch(`${apiPath.detail}/${rid}/flow`, { method: 'PUT', body: JSON.stringify({ nodes: dbNodes, edges: dbEdges }) });
      if (flowRes.code !== 200) { ok = false; throw new Error(flowRes.message || '保存流程图失败'); }
    } catch (err) { ok = false; notification.error(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); if (ok) { setIsDirty(false); notification.success('保存成功'); } }
  };

  const handleExecute = async () => {
    if (!realIdRef.current) { notification.warning('请先保存场景后再执行'); return; }
    setExecuting(true); setExecutionResult(null);
    try {
      const res = await apiFetch<ScenarioLog>(`${API_PATH_MAP[testType]?.detail || '/scenarios'}/${realIdRef.current}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) });
      if (res.code === 200 && res.data) {
        setExecutionResult(res.data);
        if (res.data.node_results) {
          const results: Record<string, NodeExecutionResult> = JSON.parse(res.data.node_results);
          setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, executionStatus: results[n.id]?.status || 'skipped', conditionResult: results[n.id]?.condition_result } })));
        }
        const [logsRes, execRes] = await Promise.all([
          apiFetch<ScenarioLog[]>(`${API_PATH_MAP[testType]?.detail || '/scenarios'}/${realIdRef.current}/logs`),
          apiFetch<ScenarioExecution[]>(`${API_PATH_MAP[testType]?.detail || '/scenarios'}/${realIdRef.current}/executions`),
        ]);
        if (logsRes.code === 200 && logsRes.data) {
          setLogs(logsRes.data);
          if (logsRes.data.length > 0) setExpandedLog(logsRes.data[0].id);
        }
        if (execRes.code === 200 && execRes.data && execRes.data.length > 0) {
          setScenarioExecutions(execRes.data);
          // Fetch detail for leader + sub_executions
          const fetchDetail = (exec: ScenarioExecution): Promise<ScenarioExecution> => {
            return apiFetch<ScenarioExecution & { steps: ScenarioExecutionStep[] }>(`${API_PATH_MAP[testType]?.detail || '/scenarios'}/${realIdRef.current}/executions/${exec.id}`).then((detailRes) => {
              if (detailRes.code === 200 && detailRes.data) {
                return { ...exec, ...detailRes.data };
              }
              return exec;
            });
          };
          Promise.all(execRes.data.map(async (exec) => {
            const leader = await fetchDetail(exec);
            if (leader.sub_executions && leader.sub_executions.length > 0) {
              const subs = await Promise.all(leader.sub_executions.map(sub => fetchDetail(sub)));
              return { ...leader, sub_executions: subs };
            }
            return leader;
          })).then((updated) => {
            setScenarioExecutions(updated);
            setSelectedScenarioExecution(updated[0] || null);
            setActiveTab('logs');
          });
        }
      }
    } catch (err) { notification.error(err instanceof Error ? err.message : '执行失败'); }
    finally { setExecuting(false); }
  };

  if (!scenario) return <div className="scenario-empty">加载中...</div>;

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="api-detail-row">
          <div className="field"><label>场景名称</label><InlineText value={scenario.name} onChange={v => saveField('name', v)} placeholder="点击输入场景名称" /></div>
          <div className="field"><label>状态</label><InlineSelect value={scenario.status} options={STATUS_OPTIONS} onChange={v => saveField('status', v)} renderDisplay={(v, label) => <span className={`scenario-status scenario-status-${v}`}>{label}</span>} /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>描述</label><InlineText value={scenario.description || ''} onChange={v => saveField('description', v)} placeholder="点击输入场景描述" multiline /></div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>标签</label>
            <TagInput
              value={scenario.tags || ''}
              onChange={v => saveField('tags', v)}
              placeholder="输入标签，回车确认"
            />
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>创建时间</label><span className="field-value">{toLocalDateTime(scenario.created_at)}</span></div>
          <div className="field"><label>更新时间</label><span className="field-value">{toLocalDateTime(scenario.updated_at)}</span></div>
        </div>
      </div>
    </div>
  );

  // ─── Tab: Flow ───
  const renderFlowTab = () => (
    <div className="tab-content-wrapper" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="ad-section" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="scenario-toolbar">
          <div className="scenario-toolbar-title">添加节点</div>
          <button className="ad-btn ad-btn-default ad-btn-sm" onClick={() => addNode('start')}>开始</button>
          <button className="ad-btn ad-btn-default ad-btn-sm" onClick={() => addNode('api')}>接口</button>
          <button className="ad-btn ad-btn-default ad-btn-sm" onClick={() => addNode('condition')}>条件</button>
          <button className="ad-btn ad-btn-default ad-btn-sm" onClick={() => addNode('end')}>结束</button>
        </div>
        <div className="scenario-canvas-wrapper" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
          <div className="scenario-canvas" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
              nodeTypes={nodeTypes} snapToGrid snapGrid={[16, 16]}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
              nodesDraggable={true} nodesConnectable={true} selectionMode={SelectionMode.Partial}
              style={{ width: '100%', height: '100%' }}>
              <Background /><Controls />
            </ReactFlow>
          </div>
          {selectedNode && (
            <div className="scenario-config-panel">
              <NodeConfigPanel node={selectedNode} apis={apis}
                availableVariables={currentNodeAvailableVars}
                onUpdate={(data) => updateNodeData(selectedNode.id, data)} onDelete={() => deleteNode(selectedNode.id)} onClose={() => setSelectedNode(null)} />
            </div>
          )}
        </div>
      </div>
      {executionResult && (<ExecutionResultPanel log={executionResult} nodes={nodes} edges={edges} onClose={() => setExecutionResult(null)} />)}
    </div>
  );

  // ─── Tab: Params ───
  const renderParamsTab = () => {
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
      setIsDirty(true);
    };
    // 删除列
    const removeColumn = (colIdx: number) => {
      setParamConfig(p => ({
        ...p,
        headers: p.headers.filter((_, i) => i !== colIdx),
        rows: p.rows.map(row => row.filter((_, i) => i !== colIdx)),
      }));
      setIsDirty(true);
    };
    // 添加行
    const addRow = () => {
      setParamConfig(p => ({
        ...p,
        rows: [...p.rows, new Array(p.headers.length).fill('')],
        enabledRows: [...p.enabledRows, true],
      }));
      setIsDirty(true);
    };
    // 删除行
    const removeRow = (rowIdx: number) => {
      setParamConfig(p => ({
        ...p,
        rows: p.rows.filter((_, i) => i !== rowIdx),
        enabledRows: p.enabledRows.filter((_, i) => i !== rowIdx),
      }));
      setIsDirty(true);
    };
    // 切换行启用状态
    const toggleRowEnabled = (rowIdx: number) => {
      setParamConfig(p => {
        const enabledRows = [...p.enabledRows];
        enabledRows[rowIdx] = !enabledRows[rowIdx];
        return { ...p, enabledRows };
      });
      setIsDirty(true);
    };
    // 全选 / 全不选
    const toggleAllRows = (checked: boolean) => {
      setParamConfig(p => ({
        ...p,
        enabledRows: p.rows.map(() => checked),
      }));
      setIsDirty(true);
    };
    // 修改列头
    const setHeader = (colIdx: number, val: string) => {
      setParamConfig(p => {
        const headers = [...p.headers];
        headers[colIdx] = val;
        return { ...p, headers };
      });
      setIsDirty(true);
    };
    // 修改单元格
    const setCell = (rowIdx: number, colIdx: number, val: string) => {
      setParamConfig(p => {
        const rows = p.rows.map((row, ri) => ri === rowIdx ? row.map((cell, ci) => ci === colIdx ? val : cell) : row);
        return { ...p, rows };
      });
      setIsDirty(true);
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
        setIsDirty(true);
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

    // 从流程图节点提取参数化 keys
    const extractFromNodes = async () => {
      const apiNodes = nodes.filter(n => n.type === 'api');
      if (apiNodes.length === 0) { notification.warning('流程图中没有 API 节点'); return; }
      const seen = new Set<string>();
      const newHeaders: string[] = [];

      for (const n of apiNodes) {
        const config = (n.data || {}) as unknown as ApiNodeConfig;
        if (!config.api_id) continue;
        try {
          const res = await apiFetch<ApiItem>(`/apis/${config.api_id}`);
          if (res.code === 200 && res.data?.parameters) {
            const params = JSON.parse(res.data.parameters);
            if (params.headers && Array.isArray(params.headers)) {
              params.headers.forEach((h: string) => {
                if (h && !seen.has(h)) { seen.add(h); newHeaders.push(h); }
              });
            }
          }
        } catch (err) { console.error('提取参数失败', err); }
      }

      if (newHeaders.length === 0) { notification.warning('未从节点中提取到参数化字段'); return; }

      setParamConfig(prev => {
        const combinedHeaders = [...prev.headers, ...newHeaders.filter(h => !prev.headers.includes(h))];
        const rowsWithCorrectCols = prev.rows.length > 0
          ? prev.rows.map(row => { const nr = [...row]; while (nr.length < combinedHeaders.length) nr.push(''); return nr; })
          : [];
        return { ...prev, headers: combinedHeaders, rows: rowsWithCorrectCols };
      });
      setIsDirty(true);
    };

    return (
      <div className="tab-content-wrapper">
        <div className="ad-section">
          <div className="param-table-wrapper">
            <div className="param-action-row">
              <button type="button" className="ad-btn ad-btn-sm" onClick={addColumn}>添加列</button>
              <button type="button" className="ad-btn ad-btn-sm" onClick={addRow}>添加行</button>
              <button type="button" className="ad-btn ad-btn-sm" onClick={extractFromNodes}>从节点提取</button>
              <label className="ad-btn ad-btn-sm" style={{ cursor: 'pointer' }}>
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} />
                上传 CSV
              </label>
              <button type="button" className="ad-btn ad-btn-sm" onClick={downloadTemplate}>下载模板</button>
            </div>

            {paramConfig.headers.length === 0 ? (
              <div className="param-empty-hint">从流程图节点提取的变量列名将显示在此处，请点击「添加列」或「上传 CSV」开始配置参数</div>
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
                    <tr><td colSpan={paramConfig.headers.length + 2} className="param-empty-row">暂无数据，点击「添加行」或「上传 CSV」添加数据</td></tr>
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
              <div>场景执行时，变量会被注入到每个节点的请求中（URL、请求头、请求体）</div>
              <div>勾选行决定该行数据是否参与执行，不勾选的行将被跳过</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Tab: Logs ───
  const renderLogsTab = () => {
    const displayRows = [...scenarioExecutions].sort((a, b) =>
      (b.started_at || '').localeCompare(a.started_at || '')
    );

    const renderExecutionRow = (execItem: ScenarioExecution & { sub_executions?: ScenarioExecution[] }) => {
      const subCount = execItem.sub_executions?.length || 0;
      const batchLabel = subCount > 0 ? ` (${subCount + 1}组)` : '';
      const isExpanded = expandedLog === execItem.id;
      return (
        <Fragment key={execItem.id}>
          <tr className={isExpanded ? 'log-row-selected' : ''}>
            <td>{toLocalDateTime(execItem.started_at)}</td>
            <td>
              <span className={`status-badge status-${execItem.status}`}>{execItem.status === 'success' ? '通过' : execItem.status === 'failed' ? '失败' : execItem.status}</span>
              {batchLabel && <span className="scenario-log-batch">{batchLabel}</span>}
            </td>
            <td>{execItem.duration_ms != null ? `${execItem.duration_ms} ms` : '-'}</td>
            <td>{execItem.executed_by || '-'}</td>
            <td><button className="log-view-btn" onClick={() => { setExpandedLog(isExpanded ? null : execItem.id); setActiveParamRow(1); }}>{isExpanded ? '收起' : '查看'}</button></td>
          </tr>
          {isExpanded && (
            <tr className="log-detail-row"><td colSpan={5}>
              <div className="log-expanded">
                {subCount > 0 ? (
                  <ScenarioBatchExecutionView execution={execItem} />
                ) : (
                  <ScenarioExecutionTimeline
                    steps={execItem.steps || []}
                    apiLinks={execItem.api_links || []}
                  />
                )}
              </div>
            </td></tr>
          )}
        </Fragment>
      );
    };

    return (
      <div className="tab-content-wrapper">
        <div className="ad-section">
          <div className="ad-section-head"><label>执行记录</label></div>
          {scenarioExecutions.length === 0 ? (<div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>) : (
            <table className="log-table">
              <thead><tr><th>执行时间</th><th>状态</th><th>耗时</th><th>执行人</th><th>操作</th></tr></thead>
              <tbody>
                {displayRows.map((row) => renderExecutionRow(row))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  // Compute route base for navigation based on test type
  const routeBase = testType === 'api' ? '/api-test/scene' : testType === 'web' ? '/web-test/scene' : testType === 'pc' ? '/pc-test/scene' : '/mobile-test/scene';

  return (
    <div className="api-detail page-enter">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate(routeBase)}>场景列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={scenario?.name || ''} onChange={e => saveField('name', e.target.value)} placeholder="输入场景名称" />
        </div>
        <div className="api-detail-meta">
          {!isNew && scenario && <span className={`status-badge-light ${scenario.status}`}>{STATUS_OPTIONS.find(o => o.value === scenario.status)?.label || scenario.status}</span>}
          {scenario?.updated_at && <span className="meta-time">更新于 {toLocalDateTime(scenario.updated_at)}</span>}
        </div>
        <div className="api-detail-actions">
          <button className={`scenario-btn${isDirty ? ' dirty' : ''}`} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          <button className={`sset-btn sset-btn-primary${!realIdRef.current ? ' scenario-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>{executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}</button>
        </div>
      </div>
      <div className="api-detail-content">
        <div className="api-detail-card">
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'flow' && renderFlowTab()}
            {activeTab === 'params' && renderParamsTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
        </div>
      </div>
    </div>
  );
}
