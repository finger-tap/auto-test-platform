import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiFetch } from '../../utils/api';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import MessageModal from '../../components/MessageModal';
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioLog, ApiItem, ApiNodeConfig, ConditionNodeConfig, NodeExecutionResult } from '../../types';
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

export default function ScenarioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  const [scenario, setScenario] = useState<Scenario | null>(isNew ? {
    id: 0, user_id: 0, name: '', description: '', tags: '', status: 'draft',
    created_at: '', updated_at: '',
  } as Scenario : null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
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

  // Ensure the scenario record exists (POST first if new). Returns the real ID.
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
        navigate(`/scenario/${res.data.id}`, { replace: true });
        setScenario(prev => prev ? { ...prev, id: res.data!.id } : prev);
        return realIdRef.current;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      return null;
    }
  };

  // Load scenario data
  useEffect(() => {
    if (!id || isNew) return;

    apiFetch<{ scenario: Scenario; nodes: ScenarioNode[]; edges: ScenarioEdge[] }>(`/scenarios/${id}`).then((res) => {
      if (res.code === 200 && res.data) {
        setScenario(res.data.scenario);

        // Convert DB nodes to ReactFlow nodes
        const rfNodes: Node[] = res.data.nodes.map((n) => ({
          id: n.node_id,
          type: n.type,
          position: { x: n.position_x, y: n.position_y },
          data: n.config ? JSON.parse(n.config) : { label: n.label },
        }));
        setNodes(rfNodes);

        // Convert DB edges to ReactFlow edges
        const rfEdges: Edge[] = res.data.edges.map((e) => ({
          id: e.edge_id,
          source: e.source_node_id,
          target: e.target_node_id,
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

  // Always load APIs for node config (needed in new mode too)
  useEffect(() => {
    apiFetch<ApiItem[]>('/apis').then((res) => {
      if (res.code === 200 && res.data) setApis(res.data);
    });
  }, []);

  // Auto-execute if coming from list
  useEffect(() => {
    if (searchParams.get('exec') === '1' && !autoExecRef.current && scenario) {
      autoExecRef.current = true;
      handleExecute();
    }
  }, [scenario]);

  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => addEdge({ ...params, animated: false }, eds));
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Add new node
  const addNode = useCallback((type: string) => {
    const nodeCount = nodes.filter((n) => n.type === type).length;
    const id = `${type}_${Date.now()}`;
    let data: Record<string, unknown> = {};

    switch (type) {
      case 'start':
        data = { label: '开始' };
        break;
      case 'end':
        data = { label: '结束' };
        break;
      case 'api':
        data = { api_id: 0, api_name: '', extract_rules: [] } as ApiNodeConfig;
        break;
      case 'condition':
        data = { condition_expr: '' } as ConditionNodeConfig;
        break;
    }

    const newNode: Node = {
      id,
      type,
      position: { x: 250 + nodeCount * 50, y: 200 + nodeCount * 50 },
      data,
    };

    setNodes((nds) => [...nds, newNode]);
  }, [nodes, setNodes]);

  // Update node data from config panel
  const updateNodeData = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n
      )
    );
  }, [setNodes]);

  // Delete selected node
  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'start' || nodeId === 'end') return;
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  // Auto-save a single info field
  const saveField = async (field: string, value: string) => {
    setScenario((prev) => prev ? { ...prev, [field]: value } : null);
    const rid = await ensureCreated();
    if (!rid) return;
    try {
      await apiFetch(`/scenarios/${rid}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  // Save flow
  const handleSave = async () => {
    setSaving(true);
    setError('');

    const rid = await ensureCreated();
    if (!rid) { setSaving(false); return; }

    try {
      const dbNodes = nodes.map((n) => ({
        node_id: n.id,
        type: n.type || 'api',
        position_x: n.position.x,
        position_y: n.position.y,
        label: (n.data as Record<string, unknown>).label as string || null,
        config: JSON.stringify(n.data),
      }));

      const dbEdges = edges.map((e) => ({
        edge_id: e.id,
        source_node_id: e.source,
        target_node_id: e.target,
        source_handle: e.sourceHandle || null,
        label: typeof e.label === 'string' ? e.label : null,
      }));

      const flowRes = await apiFetch(`/scenarios/${rid}/flow`, {
        method: 'PUT',
        body: JSON.stringify({ nodes: dbNodes, edges: dbEdges }),
      });

      if (flowRes.code !== 200) throw new Error(flowRes.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Execute scenario
  const handleExecute = async () => {
    if (!realIdRef.current) {
      setModalType('warning'); setModalMsg('请先保存场景后再执行'); setModalOpen(true);
      return;
    }
    setExecuting(true);
    setExecutionResult(null);
    setError('');

    try {
      // Save first
      await handleSave();

      const res = await apiFetch<ScenarioLog>(`/scenarios/${realIdRef.current}/execute`, { method: 'POST' });
      if (res.code === 200 && res.data) {
        setExecutionResult(res.data);

        // Update node execution status
        if (res.data.node_results) {
          const results: Record<string, NodeExecutionResult> = JSON.parse(res.data.node_results);
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                executionStatus: results[n.id]?.status || 'skipped',
                conditionResult: results[n.id]?.condition_result,
              },
            }))
          );
        }

        // Refresh logs
        const logsRes = await apiFetch<ScenarioLog[]>(`/scenarios/${realIdRef.current}/logs`);
        if (logsRes.code === 200 && logsRes.data) setLogs(logsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setExecuting(false);
    }
  };

  // Get available variables for condition editor
  const availableVariables = useMemo(() => {
    const vars: string[] = ['status_code'];
    nodes.forEach((n) => {
      if (n.type === 'api') {
        const config = n.data as unknown as ApiNodeConfig;
        config.extract_rules?.forEach((rule) => {
          if (rule.var_name) vars.push(rule.var_name);
        });
      }
    });
    return [...new Set(vars)];
  }, [nodes]);

  if (!scenario) return <div className="scenario-empty">加载中...</div>;

  const tagList = scenario.tags ? scenario.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return (
    <div className="scenario-detail">
      {/* Back + Actions */}
      <div className="scenario-top-bar">
        <button className="scenario-back" onClick={() => navigate('/scenario')}>
          ← 返回列表
        </button>
        <div className="scenario-title-spacer" />
        <div className="scenario-header-actions">
          <button className="scenario-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className={`scenario-btn scenario-btn-primary ${!realIdRef.current ? 'scenario-btn-disabled' : ''}`} onClick={handleExecute} disabled={executing}>
            {executing ? <><span className="ad-btn-loading">⟳</span> 执行中</> : '执行'}
          </button>
        </div>
      </div>

      {error && <div className="scenario-error">{error}</div>}

      {/* Card 1: 场景详情 */}
      <div className="scenario-detail-card">
        <h3>场景详情</h3>
        <div style={{ marginTop: 16 }}>
          <div className="api-detail-row">
            <div className="field">
              <label>场景名称</label>
              <InlineText value={scenario.name} onSave={v => saveField('name', v)} placeholder="点击输入场景名称" />
            </div>
            <div className="field">
              <label>状态</label>
              <InlineSelect
                value={scenario.status}
                options={STATUS_OPTIONS}
                onSave={v => saveField('status', v)}
                renderDisplay={(v, label) => <span className={`scenario-status scenario-status-${v}`}>{label}</span>}
              />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>描述</label>
              <InlineText value={scenario.description || ''} onSave={v => saveField('description', v)} placeholder="点击输入场景描述" multiline />
            </div>
          </div>
          <div className="api-detail-row">
            <div className="field">
              <label>标签</label>
              <div className="scenario-inline-tags">
                <InlineText value={scenario.tags || ''} onSave={v => saveField('tags', v)} placeholder="点击输入标签（逗号分隔）" />
                {tagList.length > 0 && (
                  <div className="scenario-tags">
                    {tagList.map((tag, i) => (
                      <span key={i} className="scenario-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card 2: 场景编排 */}
      <div className="scenario-detail-card">
        <div className="scenario-detail-card-head">
          <h3>场景编排</h3>
        </div>
        <div className="scenario-body">
          {/* Toolbar */}
          <div className="scenario-toolbar">
            <div className="scenario-toolbar-title">添加节点</div>
            <button className="scenario-toolbar-btn" onClick={() => addNode('start')}>开始</button>
            <button className="scenario-toolbar-btn" onClick={() => addNode('api')}>接口</button>
            <button className="scenario-toolbar-btn" onClick={() => addNode('condition')}>条件</button>
            <button className="scenario-toolbar-btn" onClick={() => addNode('end')}>结束</button>
          </div>

          {/* Flow canvas */}
          <div className="scenario-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>

          {/* Config panel */}
          {selectedNode && (
            <NodeConfigPanel
              node={selectedNode}
              apis={apis}
              availableVariables={availableVariables}
              onUpdate={(data) => updateNodeData(selectedNode.id, data)}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </div>
      </div>

      {/* Execution result */}
      {executionResult && (
        <ExecutionResultPanel
          log={executionResult}
          nodes={nodes}
          edges={edges}
          onClose={() => setExecutionResult(null)}
        />
      )}

      {/* Card 3: 执行日志 */}
      <div className="scenario-detail-card">
        <h3>执行日志</h3>
        {logs.length === 0 ? (
          <div className="scenario-logs-empty">暂无执行记录</div>
        ) : (
          <table className="scenario-logs-table">
            <thead>
              <tr>
                <th>执行时间</th>
                <th>状态</th>
                <th>耗时</th>
                <th>执行人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr>
                    <td>{log.executed_at.replace('T', ' ').slice(0, 19)}</td>
                    <td><span className={`scenario-log-status scenario-log-${log.status}`}>{log.status}</span></td>
                    <td>{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</td>
                    <td>{log.executed_by || '-'}</td>
                    <td>
                      <button className="scenario-log-view" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                        {expandedLog === log.id ? '收起' : '查看'}
                      </button>
                    </td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr>
                      <td colSpan={5} className="scenario-log-expanded">
                        <ExecutionResultPanel
                          log={log}
                          nodes={nodes}
                          edges={edges}
                          title="执行记录"
                          onClose={() => setExpandedLog(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MessageModal open={modalOpen} message={modalMsg} type={modalType} onClose={() => setModalOpen(false)} />
    </div>
  );
}
