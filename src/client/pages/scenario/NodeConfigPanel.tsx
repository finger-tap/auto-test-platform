import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Node } from '@xyflow/react';
import type { ApiItem, ApiNodeConfig, ConditionNodeConfig, ExtractRule, AssertionRule } from '../../types';
import FormSelect from '../../components/FormSelect';
import notification from '../../utils/notification';
import { apiFetch, is2xx } from '../../utils/api';

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
  // 2026-08-28: 远程搜索模式 — 下拉数据不再依赖父组件预拉全量(>10 条就反显
  // 失败), 改为: 打开/输入时按 name 分页查询; 已选案例按 id 精确查询反显。
  const [remoteOptions, setRemoteOptions] = useState<ApiItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const searchSeqRef = useRef(0);
  // 反显专用: 节点打开时按 id 精确查到的案例 — 不进下拉候选, 只用于
  // 输入框回显与 api_name 回写
  const [exactItem, setExactItem] = useState<ApiItem | null>(null);
  // 搜索态: 聚焦期间显示 searchText(空则占位符), 失焦恢复反显已选案例名
  const [searching, setSearching] = useState(false);
  // 提取规则（独立数组）
  const [extractions, setExtractions] = useState<ExtractRule[]>([]);
  // 断言规则（独立数组）
  const [assertions, setAssertions] = useState<AssertionRule[]>([]);
  // 正在编辑的规则名索引
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  // 规则名称编辑值
  const [editingNameValue, setEditingNameValue] = useState('');

  // 全量查找池(反显/回写用): 父缓存 + 精确查 + 远程结果
  const options = useMemo(() => {
    const map = new Map<number, ApiItem>();
    for (const a of apiList) map.set(a.id, a);
    if (exactItem) map.set(exactItem.id, exactItem);
    for (const a of remoteOptions) map.set(a.id, a);
    return [...map.values()];
  }, [apiList, exactItem, remoteOptions]);

  // 下拉候选 = 仅远程查询结果 — 缓存/已选项不混入, 切换案例时不碍事
  const filteredApis = remoteOptions;

  const selectedApi = useMemo(() => options.find((a) => a.id === apiId), [options, apiId]);

  // 远程查询: name 为空拉第一页, 有值模糊搜索 (300ms 防抖)
  const fetchOptions = useCallback(async (name: string) => {
    const seq = ++searchSeqRef.current;
    setRemoteLoading(true);
    try {
      const qs = new URLSearchParams({ page: '1', pageSize: '20' });
      if (name.trim()) qs.set('name', name.trim());
      const res = await apiFetch<{ items: ApiItem[] }>(`/apis?${qs.toString()}`);
      if (seq !== searchSeqRef.current) return; // 过期响应丢弃
      if (is2xx(res.code)) setRemoteOptions(res.data?.items ?? []);
    } catch { /* 网络错误保留下旧列表 */ } finally {
      if (seq === searchSeqRef.current) setRemoteLoading(false);
    }
  }, []);

  // 节点打开时: 已选案例不在本地 → 按 id 精确查一条用于反显
  useEffect(() => {
    setApiId(config.api_id || 0);
    setSearchText('');
    setDropdownOpen(false);
    setSearching(false);
    setExtractions(migrateExtractions(config));
    setAssertions(migrateAssertions(config));
    const wanted = config.api_id || 0;
    setExactItem(null);
    if (wanted > 0 && !apiList.some((a) => a.id === wanted)) {
      apiFetch<ApiItem>(`/apis/${wanted}`).then((res) => {
        if (is2xx(res.code) && res.data) setExactItem(res.data);
      }).catch(() => {});
    }
  }, [node.id]);

  // 保存完整数据到父组件
  const save = useCallback((updates?: Record<string, unknown>) => {
    const selApi = options.find((a) => a.id === apiId);
    onUpdate({
      api_id: apiId,
      api_name: selApi?.name || selectedApi?.name || '',
      extractions: extractions.length > 0 ? extractions : undefined,
      assertions: assertions.length > 0 ? assertions : undefined,
      ...updates,
    });
  }, [apiId, selectedApi, options, extractions, assertions, onUpdate]);

  const handleApiSelect = (id: number) => {
    setApiId(id);
    setSearchText('');
    setDropdownOpen(false);
    setSearching(false);
    setExtractions([]);
    setAssertions([]);
    const selApi = options.find((a) => a.id === id);
    onUpdate({
      api_id: id,
      api_name: selApi?.name || '',
      extractions: undefined,
      assertions: undefined,
    });
  };

  // 输入即远程模糊搜索(防抖); 首次打开下拉拉第一页
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleApiSearchChange = (value: string) => {
    setSearchText(value);
    if (!dropdownOpen) setDropdownOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchOptions(value); }, 300);
  };

  const handleApiFocus = () => {
    // 每次点击都查询(分页第一页) — 数据新鲜且不依赖缓存; 进入搜索态后
    // 输入框清空可直接打关键词, 不用手动删掉反显的案例名
    setSearching(true);
    setDropdownOpen(true);
    setSearchText('');
    void fetchOptions('');
  };

  const handleApiBlur = () => {
    setTimeout(() => {
      setDropdownOpen(false);
      setSearching(false);
      setSearchText('');
    }, 200);
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
      notification.warning('该接口未配置断言，请手动添加');
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
      notification.error('解析接口断言失败');
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
                value={searching ? searchText : (selectedApi ? `${selectedApi.method} ${selectedApi.name}` : '')}
                onChange={(e) => handleApiSearchChange(e.target.value)}
                onFocus={handleApiFocus}
                onBlur={handleApiBlur}
                placeholder="输入名称模糊查找"
              />
              {selectedApi && !searching && (
                <button
                  type="button"
                  className="api-search-clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchText('');
                    setApiId(0);
                    setDropdownOpen(true);
                    void fetchOptions('');
                  }}
                  title="清空选择"
                >
                  ✕
                </button>
              )}
            </div>
            {dropdownOpen && (
              <div className="api-search-dropdown-list">
                {remoteLoading && (
                  <div className="api-search-empty">查询中…</div>
                )}
                {!remoteLoading && filteredApis.length === 0 && (
                  <div className="api-search-empty">{searchText ? '无匹配接口，换个关键词试试' : '暂无接口'}</div>
                )}
                {filteredApis.map((api) => (
                    <div
                      key={api.id}
                      className={`api-search-item ${api.id === apiId ? 'selected' : ''}`}
                      onMouseDown={() => handleApiSelect(api.id)}
                    >
                      <span className={`api-method api-method-${api.method.toLowerCase()}`}>{api.method}</span>
                      <span className="api-name">{api.name}</span>
                    </div>
                  ))}
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
                <FormSelect value={rule.source} options={ASSERTION_SOURCES} onChange={(v) => updateAssertion(idx, 'source', v)} size="compact" />
                <input
                  className="rule-key"
                  placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'}
                  value={rule.key}
                  onChange={(e) => updateAssertion(idx, 'key', e.target.value)}
                  disabled={rule.source === 'status'}
                />
                <label className="rule-switch rule-switch--labeled">
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
                <FormSelect className="rule-operator" value={rule.operator} options={ASSERTION_OPERATORS} onChange={(v) => updateAssertion(idx, 'operator', v)} size="compact" style={{ display: rule.assert === false ? 'none' : undefined }} />
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