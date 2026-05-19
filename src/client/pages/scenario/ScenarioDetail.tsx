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
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import MessageModal from '../../components/MessageModal';
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioLog, ApiItem, ApiNodeConfig, NodeExecutionResult } from '../../types';
import StartNode from './nodes/StartNode';
import ApiNode from './nodes/ApiNode';
import ConditionNode from './nodes/ConditionNode';
import EndNode from './nodes/EndNode';
import NodeConfigPanel from './NodeConfigPanel';
import ExecutionResultPanel from './ExecutionResultPanel';
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

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'flow', label: '流程图' },
  { key: 'logs', label: '执行记录' },
];

export default function ScenarioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
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
  const [logs, setLogs] = useState<ScenarioLog[]>([]);
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalMsg, setModalMsg] = useState('');
  const [modalType, setModalType] = useState<'error' | 'warning' | 'success'>('error');
  const [modalOpen, setModalOpen] = useState(false);
  const autoExecRef = useRef(false);
  const realIdRef = useRef<string | null>(isNew ? null : id!);
  const dirtyRef = useRef(false);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'detail');

  const ensureCreated = async (): Promise<string | null> => {
    if (realIdRef.current) return realIdRef.current;
    try {
      const res = await apiFetch<{ id: number }>('/scenarios', {
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
        navigate(`/api-test/scene-case/${res.data.id}`, { replace: true });
        setScenario(prev => prev ? { ...prev, id: res.data!.id } : prev);
        return realIdRef.current;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      return null;
    }
  };

  useEffect(() => {
    if (!id || isNew) return;
    apiFetch<{ scenario: Scenario; nodes: ScenarioNode[]; edges: ScenarioEdge[] }>(`/scenarios/${id}`).then((res) => {
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
      }
    });
    apiFetch<ScenarioLog[]>(`/scenarios/${id}/logs`).then((res) => {
      if (res.code === 200 && res.data) setLogs(res.data);
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
      case 'api': data = { api_id: 0, api_name: '', extract_rules: [] } as unknown as Record<string, unknown>; break;
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
    dirtyRef.current = true;
  }, [nodes, setNodes]);

  const updateNodeData = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n));
    dirtyRef.current = true;
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'start' || nodeId === 'end') return;
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    dirtyRef.current = true;
  }, [setNodes, setEdges]);

  const saveField = (field: string, value: string) => {
    setScenario((prev) => prev ? { ...prev, [field]: value } : null);
    dirtyRef.current = true;
  };

  const handleSave = async () => {
    setSaving(true); setError(''); let ok = true;
    const rid = await ensureCreated();
    if (!rid) { setSaving(false); return; }
    try {
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
      const flowRes = await apiFetch(`/scenarios/${rid}/flow`, { method: 'PUT', body: JSON.stringify({ nodes: dbNodes, edges: dbEdges }) });
      if (flowRes.code !== 200) { ok = false; throw new Error(flowRes.message); }
    } catch (err) { ok = false; setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); if (ok) dirtyRef.current = false; }
  };

  const handleExecute = async () => {
    if (!realIdRef.current) { setModalType('warning'); setModalMsg('请先保存场景后再执行'); setModalOpen(true); return; }
    // 如果节点为空，自动补充开始节点
    if (nodes.length === 0) {
      const startNode = [{ id: 'start-1', type: 'start' as const, position: { x: 250, y: 50 }, data: { label: '开始' } }];
      setNodes(startNode);
    }
    setExecuting(true); setExecutionResult(null); setError('');
    const { activeEnv } = useEnvironment();
    try {
      await handleSave();
      const res = await apiFetch<ScenarioLog>(`/scenarios/${realIdRef.current}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) });
      if (res.code === 200 && res.data) {
        setExecutionResult(res.data);
        if (res.data.node_results) {
          const results: Record<string, NodeExecutionResult> = JSON.parse(res.data.node_results);
          setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, executionStatus: results[n.id]?.status || 'skipped', conditionResult: results[n.id]?.condition_result } })));
        }
        const logsRes = await apiFetch<ScenarioLog[]>(`/scenarios/${realIdRef.current}/logs`);
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Execution failed'); }
    finally { setExecuting(false); }
  };

  const availableVariables = useMemo(() => {
    const vars: string[] = ['status_code'];
    nodes.forEach((n) => {
      if (n.type === 'api') {
        const config = n.data as unknown as ApiNodeConfig;
        // Support both new extractions field and legacy extract_rules
        const rules = config.extractions || config.extract_rules || [];
        rules.forEach((rule) => { if (rule.var_name) vars.push(rule.var_name); });
      }
    });
    return [...new Set(vars)];
  }, [nodes]);

  if (!scenario) return <div className="scenario-empty">加载中...</div>;

  const tagList = scenario.tags ? scenario.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="sd-section">
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
            <div className="scenario-inline-tags">
              <InlineText value={scenario.tags || ''} onChange={v => saveField('tags', v)} placeholder="点击输入标签（逗号分隔）" />
              {tagList.length > 0 && (<div className="scenario-tags">{tagList.map((tag, i) => (<span key={i} className="scenario-tag">{tag}</span>))}</div>)}
            </div>
          </div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>创建时间</label><span className="field-value">{scenario.created_at ? scenario.created_at.replace('T', ' ').slice(0, 19) : '-'}</span></div>
          <div className="field"><label>更新时间</label><span className="field-value">{scenario.updated_at ? scenario.updated_at.replace('T', ' ').slice(0, 19) : '-'}</span></div>
        </div>
      </div>
    </div>
  );

  // ─── Tab: Flow ───
  const renderFlowTab = () => (
    <div className="tab-content-wrapper" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="sd-section" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="scenario-toolbar">
          <div className="scenario-toolbar-title">添加节点</div>
          <button className="scenario-toolbar-btn" onClick={() => addNode('start')}>开始</button>
          <button className="scenario-toolbar-btn" onClick={() => addNode('api')}>接口</button>
          <button className="scenario-toolbar-btn" onClick={() => addNode('condition')}>条件</button>
          <button className="scenario-toolbar-btn" onClick={() => addNode('end')}>结束</button>
        </div>
        <div className="scenario-canvas-wrapper" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
          <div className="scenario-canvas" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
              nodeTypes={nodeTypes} fitView snapToGrid snapGrid={[16, 16]}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
              nodesDraggable={true} nodesConnectable={true} selectionMode={SelectionMode.Partial}
              style={{ width: '100%', height: '100%' }}>
              <Background /><Controls />
            </ReactFlow>
          </div>
          {selectedNode && (
            <div className="scenario-config-panel">
              <NodeConfigPanel node={selectedNode} apis={apis} availableVariables={availableVariables}
                onUpdate={(data) => updateNodeData(selectedNode.id, data)} onDelete={() => deleteNode(selectedNode.id)} onClose={() => setSelectedNode(null)} />
            </div>
          )}
        </div>
      </div>
      {executionResult && (<ExecutionResultPanel log={executionResult} nodes={nodes} edges={edges} onClose={() => setExecutionResult(null)} />)}
    </div>
  );

  // ─── Tab: Logs ───
  const renderLogsTab = () => (
    <div className="tab-content-wrapper">
      {logs.length === 0 ? (<div className="scenario-logs-empty">暂无执行记录</div>) : (
        <table className="scenario-logs-table">
          <thead><tr><th>执行时间</th><th>状态</th><th>耗时</th><th>执行人</th><th>操作</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <Fragment key={log.id}>
                <tr>
                  <td>{log.executed_at.replace('T', ' ').slice(0, 19)}</td>
                  <td><span className={`scenario-log-status scenario-log-${log.status}`}>{log.status}</span></td>
                  <td>{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</td>
                  <td>{log.executed_by || '-'}</td>
                  <td><button className="scenario-log-view" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>{expandedLog === log.id ? '收起' : '查看'}</button></td>
                </tr>
                {expandedLog === log.id && (
                  <tr><td colSpan={5} className="scenario-log-expanded"><ExecutionResultPanel log={log} nodes={nodes} edges={edges} title="执行记录" onClose={() => setExpandedLog(null)} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="scenario-detail">
      <div className="scenario-detail-header">
        <button className="scenario-back" onClick={() => navigate('/api-test/scene-case')}>← 返回列表</button>
        <span className="scenario-detail-page-title">场景用例详情</span>
      </div>
      <div className="scenario-detail-content">
        <div className="scenario-detail-card" style={{ padding: 0 }}>
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'flow' && renderFlowTab()}
            {activeTab === 'logs' && renderLogsTab()}
          </div>
          {activeTab !== 'logs' && (
            <div className="detail-action-bar">
              <button className={`scenario-btn ${dirtyRef.current ? 'dirty' : ''}`} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
              <button className={`scenario-btn scenario-btn-primary ${!realIdRef.current ? 'scenario-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>{executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}</button>
            </div>
          )}
        </div>
      </div>
      {error && <div className="scenario-error">{error}</div>}
      <MessageModal open={modalOpen} message={modalMsg} type={modalType} onClose={() => setModalOpen(false)} />
    </div>
  );
}
