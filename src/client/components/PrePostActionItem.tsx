import React from 'react';
import ThemedCodeMirror from './ThemedCodeMirror';
import { javascript } from '@codemirror/lang-javascript';
import { FilterableSelect } from './InlineEdit';
import FormSelect from './FormSelect';

// 动作类型
export type ActionType = 'script' | 'db';

export interface AssertionRule {
  name?: string;
  source: 'status' | 'header' | 'body' | 'vars' | 'result' | 'row_count';
  key: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;
  assert?: boolean;
}

export interface PrePostAction {
  id: string;
  name: string;
  description?: string;
  type: ActionType;
  script: string;
  dbName: string;
  dbQuery: string;
  // 合并的提取和断言规则
  rules: AssertionRule[];
  // 是否在主体动作失败时仍执行
  alwaysRun?: boolean;
}

export const defaultAction = (name: string = ''): PrePostAction => ({
  id: Math.random().toString(36).slice(2, 10),
  name,
  description: '',
  type: 'script',
  script: '',
  dbName: '',
  dbQuery: '',
  rules: [],
  alwaysRun: false,
});

// 断言操作符
const OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'less_than', label: '小于' },
  { value: 'greater_than', label: '大于' },
  { value: 'exists', label: '存在' },
  { value: 'not_exists', label: '不存在' },
];

// 来源选项（根据动作类型使用不同选项）
const SOURCES = {
  script: [
    { value: 'vars', label: '变量' },
    { value: 'result', label: '执行结果' },
  ],
  db: [
    { value: 'result', label: '查询结果' },
    { value: 'row_count', label: '行数' },
  ],
  http: [
    { value: 'status', label: '状态码' },
    { value: 'header', label: '响应头' },
    { value: 'body', label: '响应体' },
  ],
};

const ALL_SOURCES = [
  { value: 'vars', label: '变量' },
  { value: 'result', label: '执行结果' },
  { value: 'row_count', label: '行数' },
  { value: 'status', label: '状态码' },
  { value: 'header', label: '响应头' },
  { value: 'body', label: '响应体' },
];

// 单个动作项组件
interface ActionItemProps {
  action: PrePostAction;
  index: number;
  onChange: (action: PrePostAction) => void;
  onRemove: () => void;
  onDirty?: () => void;
  databases?: string[]; // 可选的数据库列表
}

export const PrePostActionItem: React.FC<ActionItemProps> = ({
  action,
  index,
  onChange,
  onRemove,
  onDirty,
  databases = [],
}) => {
  const [editingRuleIdx, setEditingRuleIdx] = React.useState<number | null>(null);

  // 添加规则
  const addRule = () => {
    const defaultSource = action.type === 'db' ? 'result' : 'vars';
    const newRule: AssertionRule = {
      name: `规则${action.rules.length + 1}`,
      source: defaultSource,
      key: '',
      operator: 'equals',
      expected: '',
      assert: true, // 默认开启校验
    };
    onChange({ ...action, rules: [...action.rules, newRule] });
    onDirty?.();
  };

  // 更新规则
  const updateRule = (idx: number, field: keyof AssertionRule, value: string | boolean) => {
    const updatedRules = [...action.rules];
    updatedRules[idx] = { ...updatedRules[idx], [field]: value };
    onChange({ ...action, rules: updatedRules });
    onDirty?.();
  };

  // 删除规则
  const removeRule = (idx: number) => {
    onChange({ ...action, rules: action.rules.filter((_, i) => i !== idx) });
    onDirty?.();
  };

  // 切换校验开关：关闭时清空operator和expected
  const toggleAssert = (idx: number) => {
    const updatedRules = [...action.rules];
    const rule = updatedRules[idx];
    if (rule.assert !== false) {
      // 关闭校验：清空operator和expected
      updatedRules[idx] = { ...rule, assert: false, operator: 'equals', expected: '' };
    } else {
      // 开启校验
      updatedRules[idx] = { ...rule, assert: true };
    }
    onChange({ ...action, rules: updatedRules });
    onDirty?.();
  };

  return (
    <div className="action-item">
      {/* 第一行：序号、名称、类型、描述、删除 */}
      <div className="action-item-header">
        <span className="action-index">#{index + 1}</span>
        <input
          className="action-name-input"
          value={action.name}
          onChange={e => {
            onChange({ ...action, name: e.target.value });
            onDirty?.();
          }}
          placeholder="动作名称"
        />
        <FormSelect
          className="action-type-select"
          value={action.type}
          options={[
            { value: 'script', label: '脚本' },
            { value: 'db', label: '数据库' },
          ]}
          onChange={v => {
            onChange({ ...action, type: v as ActionType });
            onDirty?.();
          }}
        />
        <input
          className="action-desc-input"
          value={action.description || ''}
          onChange={e => {
            onChange({ ...action, description: e.target.value });
            onDirty?.();
          }}
          placeholder="动作描述"
        />
        <label className="action-always-run">
          <input
            type="checkbox"
            checked={action.alwaysRun || false}
            onChange={e => {
              onChange({ ...action, alwaysRun: e.target.checked });
              onDirty?.();
            }}
          />
          <span>主体失败时仍执行</span>
        </label>
        <button type="button" className="action-item-remove" onClick={onRemove}>×</button>
      </div>

      {/* 第二行：编辑器 */}
      <div className="action-item-editor">
        {action.type === 'script' && (
          <div className="action-editor-wrap">
            <ThemedCodeMirror
              value={action.script}
              height="140px"
              extensions={[javascript()]}
              onChange={val => {
                onChange({ ...action, script: val });
                onDirty?.();
              }}
              placeholder={`// 示例：设置变量\nsetVar('token', 'abc123');\n\n// 获取环境变量\ngetVar('api_key');`}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true }}
            />
          </div>
        )}
        {action.type === 'db' && (
          <div className="db-query-row">
            <div className="db-query-field" style={{ flex: 1 }}>
              <label>数据库</label>
              <FilterableSelect
                className="db-select"
                placeholder="选择或输入数据库"
                value={action.dbName || ''}
                onChange={val => {
                  onChange({ ...action, dbName: val });
                  onDirty?.();
                }}
                options={databases.map(db => ({ label: db, value: db }))}
              />
            </div>
            <div className="db-query-field" style={{ flex: 3 }}>
              <label>SQL 查询</label>
              <textarea
                placeholder="SELECT * FROM users WHERE id = 1"
                value={action.dbQuery}
                onChange={e => {
                  onChange({ ...action, dbQuery: e.target.value });
                  onDirty?.();
                }}
                rows={3}
              />
            </div>
          </div>
        )}
      </div>

      {/* 第三行：提取和断言规则 */}
      <div className="action-item-rules">
        <div className="ad-section-head"><label>提取 & 断言</label></div>
        {action.rules.length === 0 ? (
          <div className="ad-empty-hint">暂无规则</div>
        ) : (
          <div className="rules-list">
            {action.rules.map((rule, idx) => (
            <div key={idx} className={`rule-card ${rule.assert === false ? 'rule-extract' : 'rule-assert'}`}>
              <span className="rule-index">{idx + 1}</span>
              {/* 规则名称：hover显示笔图标，点击编辑 */}
              {editingRuleIdx === idx ? (
                <input
                  className="main-rule-name-input"
                  autoFocus
                  value={rule.name || ''}
                  placeholder={`规则 ${idx + 1}`}
                  onChange={e => updateRule(idx, 'name', e.target.value)}
                  onBlur={() => setEditingRuleIdx(null)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingRuleIdx(null); }}
                />
              ) : (
                <span className="main-rule-name" onClick={() => setEditingRuleIdx(idx)}>
                  {rule.name || `规则${idx + 1}`}
                  <span className="main-rule-name-edit">✎</span>
                </span>
              )}
              <FormSelect
                className="rule-source"
                value={rule.source}
                options={action.type === 'db' ? SOURCES.db : SOURCES.script}
                onChange={v => updateRule(idx, 'source', v)}
                size="compact"
              />
              <input
                className="rule-key"
                placeholder={rule.source === 'status' ? '(自动)' : '变量名或路径如 data.id'}
                value={rule.key}
                onChange={e => updateRule(idx, 'key', e.target.value)}
                disabled={rule.source === 'status'}
              />
              {/* 校验开关：开关控制后面operator和expected的显示 */}
              <label className="rule-switch rule-switch--labeled">
                <input
                  type="checkbox"
                  checked={rule.assert !== false}
                  onChange={() => toggleAssert(idx)}
                />
                <span className="rule-switch-slider">
                  <span className="rule-switch-label">{rule.assert !== false ? '检查' : '提取'}</span>
                </span>
              </label>
              <FormSelect
                className="rule-operator"
                value={rule.operator}
                options={OPERATORS}
                onChange={v => updateRule(idx, 'operator', v)}
                size="compact"
                style={{ display: rule.assert === false ? 'none' : undefined }}
              />
              {rule.assert !== false && !['exists', 'not_exists'].includes(rule.operator) && (
                <input
                  className="rule-expected"
                  placeholder="期望值"
                  value={rule.expected}
                  onChange={e => updateRule(idx, 'expected', e.target.value)}
                />
              )}
              <button type="button" className="rule-del" onClick={() => removeRule(idx)}>✕</button>
            </div>
          ))}
          </div>
        )}
        <button type="button" className="ad-btn ad-btn-sm" style={{ marginTop: 8, display: 'block' }} onClick={addRule}>+ 添加规则</button>
      </div>
    </div>
  );
};

// 动作列表组件
interface ActionListProps {
  actions: PrePostAction[];
  onChange: (actions: PrePostAction[]) => void;
  label?: string;
  onDirty?: () => void;
  databases?: string[]; // 可选的数据库列表
}

export const PrePostActionList: React.FC<ActionListProps> = ({
  actions,
  onChange,
  label = '添加动作',
  onDirty,
  databases = [],
}) => {
  const addAction = (type: ActionType = 'script') => {
    const newAction = {
      ...defaultAction(`${type === 'script' ? '脚本' : '数据库'}动作${actions.length + 1}`),
      type,
    };
    onChange([...actions, newAction]);
    onDirty?.();
  };

  const updateAction = (id: string, updated: PrePostAction) => {
    onChange(actions.map(a => a.id === id ? updated : a));
  };

  const removeAction = (id: string) => {
    onChange(actions.filter(a => a.id !== id));
    onDirty?.();
  };

  return (
    <div className="action-list">
      {actions.length === 0 ? (
        <div className="action-list-empty">
          <span>暂无动作</span>
        </div>
      ) : (
        actions.map((action, i) => (
          <PrePostActionItem
            key={action.id}
            action={action}
            index={i}
            onChange={updated => updateAction(action.id, updated)}
            onRemove={() => removeAction(action.id)}
            onDirty={onDirty}
          />
        ))
      )}
      <div className="action-add-btns">
        <button type="button" className="ad-btn ad-btn-sm" onClick={() => addAction('script')}>+ {label}</button>
      </div>
    </div>
  );
};