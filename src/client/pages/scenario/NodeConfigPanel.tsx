import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import type { ApiItem, ApiNodeConfig, ConditionNodeConfig, ExtractRule, AssertionRule } from '../../types';

// Rich variable info with source tracking
export interface AvailableVar {
  varName: string;
  sourceNode: string;
  sourceNodeName: string;
  stage?: string;
}

interface Props {
  node: Node;
  apis: ApiItem[];
  availableVariables: AvailableVar[];
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}

// Flat string list for components that just need var names
export function flattenVars(vars: AvailableVar[]): string[] {
  return vars.map((v) => v.varName);
}

export default function NodeConfigPanel({ node, apis, availableVariables, onUpdate, onDelete, onClose }: Props) {
  const nodeType = node.type;

  if (nodeType === 'start' || nodeType === 'end') {
    const label = (node.data as Record<string, unknown>).label as string || (nodeType === 'start' ? '开始' : '结束');
    return (
      <div className="scenario-config-panel">
        <div className="scenario-config-header">
          <h3>{nodeType === 'start' ? '开始节点' : '结束节点'}</h3>
          <button className="scenario-config-close" onClick={onClose}>✕</button>
        </div>
        <div className="scenario-config-body">
          <div className="scenario-config-field">
            <label>节点名称</label>
            <input
              className="scenario-config-input"
              value={label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="输入节点名称"
            />
          </div>
          <p style={{ color: '#999', fontSize: 13 }}>此节点无需其他配置</p>
        </div>
      </div>
    );
  }

  if (nodeType === 'api') {
    return (
      <ApiNodeConfigPanel
        node={node}
        apis={apis}
        availableVariables={availableVariables}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
  }

  if (nodeType === 'condition') {
    return (
      <ConditionNodeConfigPanel
        node={node}
        availableVariables={availableVariables}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
  }

  return null;
}

const ASSERTION_SOURCES = [
  { value: 'status', label: '状态码' },
  { value: 'header', label: '响应头' },
  { value: 'body', label: '响应体' },
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

// Generate default extraction rule
const defaultExtraction = (index: number): ExtractRule => ({
  var_name: `var_${index}`,
  source: 'body',
  key: '',
});

// Generate default assertion rule
const defaultAssertion = (index: number): AssertionRule => ({
  name: `规则${index}`,
  source: 'status',
  key: '',
  operator: 'equals',
  expected: '',
  assert: true,
});

// Map old extract_rules (assert=false) to new extractions
function migrateExtractions(config: ApiNodeConfig): ExtractRule[] {
  if (config.extractions && config.extractions.length > 0) return config.extractions;
  if (config.extract_rules && config.extract_rules.length > 0) {
    return config.extract_rules.map((r) => ({ var_name: r.var_name, source: r.source, key: r.key }));
  }
  return [];
}

// Map old assertions array to new separate assertions
function migrateAssertions(config: ApiNodeConfig): AssertionRule[] {
  if (config.assertions && config.assertions.length > 0) return config.assertions;
  return [];
}

function ApiNodeConfigPanel({ node, apis, availableVariables, onUpdate, onDelete, onClose }: Props) {
  const config = node.data as unknown as ApiNodeConfig;
  const apiList = Array.isArray(apis) ? apis : [];
  // 当前选中的接口ID
  const [apiId, setApiId] = useState(config.api_id || 0);
  // 下拉模糊搜索
  const [searchText, setSearchText] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // 提取规则（独立数组）
  const [extractions, setExtractions] = useState<ExtractRule[]>([]);
  // 断言规则（独立数组）
  const [assertions, setAssertions] = useState<AssertionRule[]>([]);
  // 正在编辑的规则名索引
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  // 规则名称编辑值
  const [editingNameValue, setEditingNameValue] = useState('');

  const filteredApis = useMemo(() => {
    if (!searchText.trim()) return apiList;
    const kw = searchText.toLowerCase();
    return apiList.filter(
      (a) => a.name.toLowerCase().includes(kw) || a.method.toLowerCase().includes(kw) || a.url.toLowerCase().includes(kw)
    );
  }, [apiList, searchText]);

  const selectedApi = useMemo(() => apiList.find((a) => a.id === apiId), [apiList, apiId]);

  // 初始化和切换节点时回显数据
  useEffect(() => {
    setApiId(config.api_id || 0);
    setSearchText('');
    setDropdownOpen(false);
    setExtractions(migrateExtractions(config));
    setAssertions(migrateAssertions(config));
  }, [node.id]);

  // 保存完整数据到父组件
  const save = useCallback((updates?: Record<string, unknown>) => {
    const selApi = apiList.find((a) => a.id === apiId);
    onUpdate({
      api_id: apiId,
      api_name: selApi?.name || selectedApi?.name || '',
      extractions: extractions.length > 0 ? extractions : undefined,
      assertions: assertions.length > 0 ? assertions : undefined,
      ...updates,
    });
  }, [apiId, selectedApi, extractions, assertions, onUpdate]);

  const handleApiSelect = (id: number) => {
    setApiId(id);
    setSearchText('');
    setDropdownOpen(false);
    setExtractions([]);
    setAssertions([]);
    const selApi = apiList.find((a) => a.id === id);
    onUpdate({
      api_id: id,
      api_name: selApi?.name || '',
      extractions: undefined,
      assertions: undefined,
    });
  };

  const handleApiSearchChange = (value: string) => {
    setSearchText(value);
    if (!dropdownOpen) setDropdownOpen(true);
  };

  const handleApiBlur = () => {
    setTimeout(() => setDropdownOpen(false), 200);
  };

  // 开始编辑规则名称
  const startEditName = (idx: number, currentName: string) => {
    setEditingNameIdx(idx);
    setEditingNameValue(currentName || `规则 ${idx + 1}`);
  };

  // 保存规则名称
  const saveEditName = (idx: number) => {
    const updated = [...assertions];
    updated[idx] = { ...updated[idx], name: editingNameValue };
    setAssertions(updated);
    save({ assertions: updated });
    setEditingNameIdx(null);
  };

  // 规则名称编辑回车保存
  const handleNameKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditName(idx);
    } else if (e.key === 'Escape') {
      setEditingNameIdx(null);
    }
  };

  // 从案例导入（提取+断言）
  const syncFromApi = () => {
    if (!selectedApi?.assertions) {
      alert('该接口未配置断言，请手动添加');
      return;
    }
    try {
      const apiAssertions: AssertionRule[] = JSON.parse(selectedApi.assertions);
      const newExtractions = apiAssertions
        .filter((a) => a.assert === false)
        .map((a) => ({ var_name: a.name || `var_${Date.now()}`, source: a.source, key: a.key }));
      const newAssertions = apiAssertions.filter((a) => a.assert !== false);
      setExtractions(newExtractions);
      setAssertions(newAssertions);
      save({ extractions: newExtractions, assertions: newAssertions });
    } catch {
      alert('解析接口断言失败');
    }
  };

  // ── Assertion actions ──
  const addAssertion = () => {
    const updated = [...assertions, defaultAssertion(assertions.length + 1)];
    setAssertions(updated);
    save({ assertions: updated });
  };

  const updateAssertion = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...assertions];
    (updated[idx] as unknown as Record<string, unknown>)[field] = value;
    setAssertions(updated);
    save({ assertions: updated });
  };

  const removeAssertion = (idx: number) => {
    const updated = assertions.filter((_, i) => i !== idx);
    setAssertions(updated);
    save({ assertions: updated });
  };

  return (
    <div className="scenario-config-panel">
      <div className="scenario-config-header">
        <h3>接口节点配置</h3>
        <button className="scenario-config-close" onClick={onClose}>✕</button>
      </div>
      <div className="scenario-config-body">
        {/* 可搜索下拉框 */}
        <div className="scenario-config-field">
          <label>选择接口</label>
          <div className="api-search-dropdown">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                className="api-search-input"
                value={searchText || (selectedApi ? `${selectedApi.method} ${selectedApi.name}` : '')}
                onChange={(e) => handleApiSearchChange(e.target.value)}
                onFocus={() => setDropdownOpen(true)}
                onBlur={handleApiBlur}
                placeholder="输入名称查询"
              />
              {(searchText || selectedApi) && (
                <button
                  type="button"
                  className="api-search-clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchText('');
                    setApiId(0);
                    setDropdownOpen(true);
                  }}
                  title="清除选择"
                >
                  ✕
                </button>
              )}
            </div>
            {dropdownOpen && (
              <div className="api-search-dropdown-list">
                {!searchText && apiList.length === 0 && (
                  <div className="api-search-empty">暂无比配接口</div>
                )}
                {filteredApis.length === 0 ? (
                  <div className="api-search-empty">无匹配接口</div>
                ) : (
                  filteredApis.map((api) => (
                    <div
                      key={api.id}
                      className={`api-search-item ${api.id === apiId ? 'selected' : ''}`}
                      onMouseDown={() => handleApiSelect(api.id)}
                    >
                      <span className={`api-method api-method-${api.method.toLowerCase()}`}>{api.method}</span>
                      <span className="api-name">{api.name}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* 上游节点传下来的变量（只读，不可修改） */}
        {(availableVariables ?? []).filter(v => v.sourceNode).length > 0 && (
          <div className="scenario-config-field">
            <label>上游变量</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(availableVariables ?? [])
                .filter(v => v.sourceNode)
                .map((v) => (
                  <div key={v.varName} className="upstream-var-row">
                    <span className="upstream-var-name">{`{${v.varName}}`}</span>
                    <span className="upstream-var-source">来自 {v.sourceNodeName}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 提取和断言 */}
        <div className="ad-section">
          <div className="ad-section-head">
            <label>提取和断言</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ad-btn ad-btn-sm" onClick={syncFromApi} disabled={!apiId}>从案例导入</button>
              <button type="button" className="ad-btn ad-btn-sm" onClick={addAssertion}>+ 添加</button>
            </div>
          </div>

          {assertions.length === 0 ? (
            <div className="ad-empty-hint">暂无提取或断言规则，点击"+ 添加"。</div>
          ) : (
            assertions.map((rule, idx) => (
              <div key={idx} className={`rule-card ${rule.assert === false ? 'rule-extract' : ''}`}>
                <span className="rule-index">{idx + 1}</span>
                {editingNameIdx === idx ? (
                  <input
                    className="rule-name-input"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onBlur={() => saveEditName(idx)}
                    onKeyDown={(e) => handleNameKeyDown(e, idx)}
                    autoFocus
                  />
                ) : (
                  <span className="main-rule-name" onClick={() => startEditName(idx, rule.name || '')} title="点击修改名称">
                    {rule.name || `规则 ${idx + 1}`}
                  </span>
                )}
                <select value={rule.source} onChange={(e) => updateAssertion(idx, 'source', e.target.value)}>
                  {ASSERTION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <input
                  className="rule-key"
                  placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'}
                  value={rule.key}
                  onChange={(e) => updateAssertion(idx, 'key', e.target.value)}
                  disabled={rule.source === 'status'}
                />
                <label className="rule-switch">
                  <input type="checkbox" checked={rule.assert !== false}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        updateAssertion(idx, 'assert', false);
                        updateAssertion(idx, 'operator', 'equals');
                        updateAssertion(idx, 'expected', '');
                      } else {
                        updateAssertion(idx, 'assert', true);
                      }
                    }} />
                  <span className="rule-switch-slider"><span className="rule-switch-label">{rule.assert !== false ? '检查' : '提取'}</span></span>
                </label>
                <select className="rule-operator" value={rule.operator} onChange={(e) => updateAssertion(idx, 'operator', e.target.value)}
                  style={{ display: rule.assert === false ? 'none' : undefined }}>
                  {ASSERTION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {rule.assert !== false && !['exists', 'not_exists'].includes(rule.operator) && (
                  <input className="rule-expected" placeholder="期望值" value={rule.expected}
                    onChange={(e) => updateAssertion(idx, 'expected', e.target.value)} />
                )}
                <button type="button" className="rule-del" onClick={() => removeAssertion(idx)}>✕</button>
              </div>
            ))
          )}
        </div>

        <div className="scenario-config-actions">
          <button className="scenario-btn" style={{ color: '#ff4d4f' }} onClick={onDelete}>删除节点</button>
        </div>
      </div>
    </div>
  );
}

function ConditionNodeConfigPanel({ node, availableVariables, onUpdate, onDelete, onClose }: Pick<Props, 'node' | 'availableVariables' | 'onUpdate' | 'onDelete' | 'onClose'>) {
  const config = node.data as unknown as ConditionNodeConfig;
  const [expr, setExpr] = useState(config.condition_expr || '');

  useEffect(() => {
    setExpr(config.condition_expr || '');
  }, [config.condition_expr]);

  const handleExprChange = (value: string) => {
    setExpr(value);
    onUpdate({ condition_expr: value });
  };

  const insertVar = (varName: string) => {
    const updated = expr + `{${varName}}`;
    handleExprChange(updated);
  };

  return (
    <div className="scenario-config-panel">
      <div className="scenario-config-header">
        <h3>条件节点配置</h3>
        <button className="scenario-config-close" onClick={onClose}>✕</button>
      </div>
      <div className="scenario-config-body">
        <div className="scenario-config-field">
          <label>条件表达式</label>
          <textarea
            value={expr}
            onChange={(e) => handleExprChange(e.target.value)}
            placeholder="例如: {status_code} == 200 && {user_id} > 0"
            rows={4}
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
            支持: ==, !=, &gt;, &lt;, &gt;=, &lt;=, &&, ||, 括号
          </div>
        </div>

        <div className="scenario-config-field">
          <label>前置节点提取的变量 (点击插入)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {availableVariables.length === 0 && (
              <span style={{ color: '#999', fontSize: 12 }}>前置无可用变量</span>
            )}
            {availableVariables.map((v) => (
              <button
                key={v.varName}
                className="scenario-toolbar-btn"
                style={{ padding: '4px 8px', fontSize: 11, position: 'relative' }}
                onClick={() => insertVar(v.varName)}
                title={`来自: ${v.sourceNodeName}`}
              >
                {`{${v.varName}}`}
              </button>
            ))}
          </div>
        </div>

        <div className="scenario-config-actions">
          <button className="scenario-btn" style={{ color: '#ff4d4f' }} onClick={onDelete}>删除节点</button>
        </div>
      </div>
    </div>
  );
}