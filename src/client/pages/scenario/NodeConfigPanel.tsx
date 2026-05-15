import { useState, useEffect } from 'react';
import type { Node } from '@xyflow/react';
import type { ApiItem, ApiNodeConfig, ConditionNodeConfig, ExtractRule, AssertionRule } from '../../types';

interface Props {
  node: Node;
  apis: ApiItem[];
  availableVariables: string[];
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function NodeConfigPanel({ node, apis, availableVariables, onUpdate, onDelete, onClose }: Props) {
  const nodeType = node.type;

  if (nodeType === 'start' || nodeType === 'end') {
    return (
      <div className="scenario-config-panel">
        <div className="scenario-config-header">
          <h3>{nodeType === 'start' ? '开始节点' : '结束节点'}</h3>
          <button className="scenario-config-close" onClick={onClose}>✕</button>
        </div>
        <div className="scenario-config-body">
          <p style={{ color: '#999', fontSize: 13 }}>此节点无需配置</p>
        </div>
      </div>
    );
  }

  if (nodeType === 'api') {
    return (
      <ApiNodeConfigPanel
        node={node}
        apis={apis}
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
const defaultAssertion = (index: number): AssertionRule => ({ name: `规则${index}`, source: 'status', key: '', operator: 'equals', expected: '', assert: true });

function ApiNodeConfigPanel({ node, apis, onUpdate, onDelete, onClose }: Omit<Props, 'availableVariables'>) {
  const config = node.data as unknown as ApiNodeConfig;
  const [apiId, setApiId] = useState(config.api_id || 0);
  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>([]);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);

  useEffect(() => {
    setApiId(config.api_id || 0);
    // Prefer assertions; fall back to converting legacy extract_rules
    if (config.assertions && config.assertions.length > 0) {
      setAssertionRules(config.assertions);
    } else if (config.extract_rules && config.extract_rules.length > 0) {
      setAssertionRules(
        config.extract_rules.map((r) => ({
          name: r.var_name,
          source: r.source,
          key: r.key,
          operator: 'equals' as const,
          expected: '',
          assert: false,
        }))
      );
    } else {
      setAssertionRules([]);
    }
  }, [config.api_id, config.extract_rules, config.assertions]);

  // Derive extract_rules from assertions for engine compatibility
  const deriveExtractRules = (assertions: AssertionRule[]): ExtractRule[] =>
    assertions.map((a) => ({
      var_name: a.name || `var_${Date.now()}`,
      source: a.source,
      key: a.key || '',
    }));

  const save = (id: number, assertions: AssertionRule[]) => {
    const selectedApi = apis.find((a) => a.id === id);
    const extractRules = deriveExtractRules(assertions);
    onUpdate({
      api_id: id,
      api_name: selectedApi?.name || '',
      extract_rules: extractRules,
      assertions: assertions.length > 0 ? assertions : undefined,
    });
  };

  const handleApiChange = (newId: number) => {
    setApiId(newId);
    save(newId, assertionRules);
  };

  const addRule = () => {
    const updated = [...assertionRules, defaultAssertion(assertionRules.length + 1)];
    setAssertionRules(updated);
    save(apiId, updated);
  };

  const updateRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updated = [...assertionRules];
    updated[idx] = { ...updated[idx], [field]: value } as AssertionRule;
    setAssertionRules(updated);
    save(apiId, updated);
  };

  const removeRule = (idx: number) => {
    const updated = assertionRules.filter((_, i) => i !== idx);
    setAssertionRules(updated);
    save(apiId, updated);
  };

  const syncFromApi = () => {
    const selectedApi = apis.find((a) => a.id === apiId);
    if (!selectedApi?.assertions) return;
    try {
      const apiAssertions: AssertionRule[] = JSON.parse(selectedApi.assertions);
      setAssertionRules(apiAssertions);
      save(apiId, apiAssertions);
    } catch { /* ignore */ }
  };

  return (
    <div className="scenario-config-panel">
      <div className="scenario-config-header">
        <h3>接口节点配置</h3>
        <button className="scenario-config-close" onClick={onClose}>✕</button>
      </div>
      <div className="scenario-config-body">
        <div className="scenario-config-field">
          <label>选择接口</label>
          <select
            value={apiId}
            onChange={(e) => handleApiChange(Number(e.target.value))}
          >
            <option value={0}>请选择接口</option>
            {apis.map((api) => (
              <option key={api.id} value={api.id}>
                {api.method} {api.name}
              </option>
            ))}
          </select>
        </div>

        {/* Combined Extraction & Assertion — same style as ApiDetail */}
        <div className="ad-section">
          <div className="ad-section-head">
            <label>提取和断言</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="ad-btn ad-btn-sm"
                onClick={syncFromApi}
                disabled={!apiId}
              >
                从接口同步
              </button>
              <button type="button" className="ad-btn ad-btn-sm" onClick={addRule}>+ 添加规则</button>
            </div>
          </div>
          {assertionRules.length === 0 && (
            <div className="ad-empty-hint">暂无规则，点击"添加规则"。提取的参数可用于后续接口和条件判断。</div>
          )}
          {assertionRules.map((rule, idx) => (
            <div key={idx} className={`ad-rule-card ${rule.assert === false ? 'assert-off' : ''}`}>
              {/* Name */}
              <div className="ad-rule-name">
                {editingNameIdx === idx ? (
                  <input
                    className="ad-rule-name-input"
                    autoFocus
                    value={rule.name || ''}
                    placeholder={`规则 ${idx + 1}`}
                    onChange={(e) => updateRule(idx, 'name', e.target.value)}
                    onBlur={() => setEditingNameIdx(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingNameIdx(null); }}
                  />
                ) : (
                  <span className="ad-rule-name-text" onClick={() => setEditingNameIdx(idx)}>
                    {rule.name || `规则 ${idx + 1}`}
                    <span className="ad-rule-name-edit">✎</span>
                  </span>
                )}
              </div>

              {/* Rule row */}
              <div className="ad-rule-row">
                <select value={rule.source} onChange={(e) => updateRule(idx, 'source', e.target.value)}>
                  {ASSERTION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <input
                  className="ad-rule-key"
                  placeholder={rule.source === 'status' ? '(自动)' : rule.source === 'header' ? 'Header名' : '路径如 data.id'}
                  value={rule.key}
                  onChange={(e) => updateRule(idx, 'key', e.target.value)}
                  disabled={rule.source === 'status'}
                />

                {/* Assert toggle */}
                <label className="ad-rule-switch">
                  <input
                    type="checkbox"
                    checked={rule.assert !== false}
                    onChange={(e) => updateRule(idx, 'assert', e.target.checked)}
                  />
                  <span className="ad-rule-switch-slider" />
                </label>

                {rule.assert !== false && (
                  <>
                    <span className="ad-rule-arrow">→</span>
                    <select value={rule.operator} onChange={(e) => updateRule(idx, 'operator', e.target.value)}>
                      {ASSERTION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {!['exists', 'not_exists'].includes(rule.operator) && (
                      <input className="ad-rule-expected" placeholder="期望值" value={rule.expected} onChange={(e) => updateRule(idx, 'expected', e.target.value)} />
                    )}
                  </>
                )}

                <button type="button" className="ad-btn-del" onClick={() => removeRule(idx)}>✕</button>
              </div>
            </div>
          ))}
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
          <label>可用变量 (点击插入)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {availableVariables.map((v) => (
              <button
                key={v}
                className="scenario-toolbar-btn"
                style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={() => insertVar(v)}
              >
                {`{${v}}`}
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
