import { useState, useMemo } from 'react';
import ThemedCodeMirror from '../../components/ThemedCodeMirror';
import { json } from '@codemirror/lang-json';
import type { Node, Edge } from '@xyflow/react';
import type { ScenarioLog, NodeExecutionResult } from '../../types';

interface Props {
  log: ScenarioLog;
  nodes: Node[];
  edges: Edge[];
  title?: string;
  onClose: () => void;
}

const tryFormatJson = (text: string | null) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

function topoSort(nodes: Node[], edges: Edge[]): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      children.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: Node[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nodeMap.get(id)!);
    for (const child of children.get(id) || []) {
      const newDeg = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  for (const n of nodes) {
    if (!sorted.find((s) => s.id === n.id)) sorted.push(n);
  }

  return sorted;
}

const ASSERTION_SRC_LABEL: Record<string, string> = { status: '状态码', header: '响应头', body: '响应体' };
const ASSERTION_OP_LABEL: Record<string, string> = {
  equals: '等于', not_equals: '不等于', contains: '包含', not_contains: '不包含',
  less_than: '小于', greater_than: '大于', exists: '存在', not_exists: '不存在',
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'success': return '成功';
    case 'failed': return '失败';
    case 'error': return '错误';
    case 'skipped': return '跳过';
    default: return status;
  }
};

const getNodeLabel = (node: Node, result: NodeExecutionResult) => {
  if (result.node_name) return result.node_name;
  if (node.type === 'start') return '开始';
  if (node.type === 'end') return '结束';
  return (node.data as Record<string, unknown>).label as string || node.type;
};

// ── Single node result card (shared between param and non-param modes) ──
function NodeResultCard({ node, result, expanded, onToggle }: {
  node: Node;
  result: NodeExecutionResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const nodeLabel = getNodeLabel(node, result);
  const hasExtract = result.extract_values && Object.keys(result.extract_values).length > 0;
  const hasAssertions = result.assertion_results && result.assertion_results.length > 0;

  return (
    <div className={`scenario-exec-node scenario-exec-${result.status}`}>
      <div className="scenario-exec-node-header" onClick={onToggle}>
        <span className={`scenario-log-status scenario-log-${result.status}`}>{statusLabel(result.status)}</span>
        <span className="scenario-exec-node-name">{nodeLabel}</span>
        {result.duration_ms != null && <span className="scenario-exec-node-duration">{result.duration_ms} ms</span>}
        <span className="scenario-exec-node-toggle">{expanded ? '收起' : '展开'}</span>
      </div>

      {expanded && (
        <div className="scenario-exec-node-detail">
          {result.condition_result !== undefined && (
            <div className="scenario-exec-field">
              <label>条件结果</label>
              <span className={result.condition_result ? 'scenario-exec-true' : 'scenario-exec-false'}>
                {result.condition_result ? 'TRUE' : 'FALSE'}
              </span>
            </div>
          )}

          {result.status_code !== undefined && (
            <>
              <div className="scenario-exec-field">
                <label>状态码</label>
                <span>{result.status_code}</span>
              </div>

              <div className="scenario-exec-section">
                <label>请求头</label>
                <ThemedCodeMirror
                  value={tryFormatJson(result.request_headers ?? null)}
                  height="auto"
                  maxHeight="150px"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>

              <div className="scenario-exec-section">
                <label>请求体</label>
                <ThemedCodeMirror
                  value={tryFormatJson(result.request_body ?? null) || '(空)'}
                  height="auto"
                  maxHeight="150px"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>

              <div className="scenario-exec-section">
                <label>响应头</label>
                <ThemedCodeMirror
                  value={tryFormatJson(result.response_headers ?? null)}
                  height="auto"
                  maxHeight="150px"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>

              <div className="scenario-exec-section">
                <label>响应体</label>
                <ThemedCodeMirror
                  value={tryFormatJson(result.response_body ?? null)}
                  height="auto"
                  maxHeight="200px"
                  extensions={[json()]}
                  editable={false}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>
            </>
          )}

          {hasExtract && (
            <div className="scenario-exec-field">
              <label>提取变量</label>
              <div className="scenario-exec-extract-values">
                {Object.entries(result.extract_values!).map(([key, value]) => (
                  <div key={key} className="scenario-exec-extract-item">
                    <span className="scenario-exec-extract-key">{`{${key}}`}</span>
                    <span className="scenario-exec-extract-val">{value || '(空)'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasAssertions && (
            <div className="scenario-exec-field">
              <label>断言结果</label>
              <div className="ad-assertion-results">
                {result.assertion_results!.map((ar, i) => (
                  <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
                    <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
                    <div className="ad-ar-detail">
                      {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
                      <div className="ad-ar-row">
                        <span className="ad-ar-label">提取:</span>
                        <span>{ASSERTION_SRC_LABEL[ar.rule.source] || ar.rule.source}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span>
                        <span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span>
                        <span className="ad-ar-extract-val">{ar.actual || '(空)'}</span>
                      </div>
                      {ar.rule.assert !== false && (
                        <div className="ad-ar-row">
                          <span className="ad-ar-label">校验:</span>
                          <span className="ad-ar-check-text">{ASSERTION_OP_LABEL[ar.rule.operator] || ar.rule.operator} {ar.rule.expected || ''}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasExtract && !hasAssertions && (
            <div className="scenario-exec-field">
              <div style={{ fontSize: 12, color: '#ccc', textAlign: 'center', padding: '8px 0' }}>暂无提取或断言</div>
            </div>
          )}

          {result.error_message && (
            <div className="scenario-exec-field">
              <label>错误信息</label>
              <span className="scenario-exec-error">{result.error_message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Parameterized mode: row-level summary ──
function ParamResultView({ log, nodes }: { log: ScenarioLog; nodes: Node[] }) {
  const [selectedRow, setSelectedRow] = useState(0);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  const results: Record<string, NodeExecutionResult> = log.node_results
    ? (typeof log.node_results === 'string' ? JSON.parse(log.node_results) : log.node_results)
    : {};
  const summary = log.param_summary!;

  // Row status: check all nodes for the given row
  const getRowStatus = (rowIdx: number): string => {
    const rowResults = Object.values(results).filter(r => r.param_row_index === rowIdx);
    if (rowResults.length === 0) return 'skipped';
    if (rowResults.some(r => r.status === 'error')) return 'error';
    if (rowResults.some(r => r.status === 'failed')) return 'failed';
    if (rowResults.every(r => r.status === 'success')) return 'success';
    return 'failed';
  };

  const getRowNodes = (rowIdx: number) => {
    return nodes.filter(node => {
      const result = results[node.id];
      return result && result.param_row_index === rowIdx;
    });
  };

  const getResultForNode = (nodeId: string, rowIdx: number) => {
    const result = results[nodeId];
    return result && result.param_row_index === rowIdx ? result : null;
  };

  return (
    <div>
      {/* Row tabs */}
      <div className="scenario-exec-row-tabs">
        {summary.row_indices.map((rowIdx, i) => {
          const status = getRowStatus(rowIdx);
          return (
            <button
              key={rowIdx}
              className={`scenario-exec-row-tab ${selectedRow === rowIdx ? 'active' : ''} scenario-exec-row-${status}`}
              onClick={() => setSelectedRow(rowIdx)}
            >
              行{i + 1}: {statusLabel(status)}
            </button>
          );
        })}
      </div>

      {/* Row detail: node cards */}
      <div className="scenario-exec-nodes">
        {getRowNodes(selectedRow).length === 0 && (
          <div className="ad-empty-hint">暂无执行节点</div>
        )}
        {getRowNodes(selectedRow).map(node => {
          const result = getResultForNode(node.id, selectedRow);
          if (!result) return null;
          return (
            <NodeResultCard
              key={`${node.id}_${selectedRow}`}
              node={node}
              result={result}
              expanded={expandedNode === `${node.id}_${selectedRow}`}
              onToggle={() => setExpandedNode(expandedNode === `${node.id}_${selectedRow}` ? null : `${node.id}_${selectedRow}`)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Non-parameterized mode (original flow) ──
function NonParamResultView({ log, nodes, edges }: { log: ScenarioLog; nodes: Node[]; edges: Edge[] }) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const results: Record<string, NodeExecutionResult> = log.node_results
    ? (typeof log.node_results === 'string' ? JSON.parse(log.node_results) : log.node_results)
    : {};
  const sortedNodes = useMemo(() => topoSort(nodes, edges), [nodes, edges]);
  const displayNodes = showAll ? sortedNodes : sortedNodes.slice(0, 5);

  return (
    <>
      <div className="scenario-exec-nodes">
        {displayNodes.length === 0 && !log.error_message && (
          <div className="ad-empty-hint">暂无执行节点</div>
        )}
        {displayNodes.map(node => {
          const result = results[node.id];
          if (!result) return null;
          return (
            <NodeResultCard
              key={node.id}
              node={node}
              result={result}
              expanded={expandedNode === node.id}
              onToggle={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
            />
          );
        })}
      </div>

      {sortedNodes.length > 5 && (
        <button className="scenario-exec-toggle-all" onClick={() => setShowAll(!showAll)}>
          {showAll ? '收起' : `展开全部 (${sortedNodes.length} 个节点)`}
        </button>
      )}
    </>
  );
}

export default function ExecutionResultPanel({ log, nodes, edges, title, onClose }: Props) {
  const isParamRun = !!(log.param_summary && log.param_summary.total_rows > 0);

  return (
    <div className="scenario-exec-result">
      <div className="scenario-exec-header">
        <h3>{title || '执行结果'}</h3>
        <div className="scenario-exec-summary">
          <span className={`scenario-log-status scenario-log-${log.status}`}>{statusLabel(log.status)}</span>
          {log.duration_ms != null && <span className="scenario-exec-duration">{log.duration_ms} ms</span>}
          {log.executed_by && <span className="scenario-exec-user">执行人: {log.executed_by}</span>}
          {isParamRun && (
            <span className="param-badge">参数化 {log.param_summary!.total_rows} 行</span>
          )}
        </div>
        <button className="scenario-config-close" onClick={onClose}>✕</button>
      </div>

      {log.error_message && (
        <div style={{ padding: '12px 0' }}>
          <div className="scenario-exec-field">
            <label>错误信息</label>
            <span className="scenario-exec-error">{log.error_message}</span>
          </div>
        </div>
      )}

      {isParamRun
        ? <ParamResultView log={log} nodes={nodes} />
        : <NonParamResultView log={log} nodes={nodes} edges={edges} />
      }
    </div>
  );
}