import { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { apiFetch } from '../../utils/api';
import type { PreAction, AssertionRule } from '../../types';
import './PreActionSection.css';

const PRE_ACTION_TYPES = [
  { value: 'script', label: '脚本' },
  { value: 'database', label: '数据库' },
];

const defaultRule = (index: number): AssertionRule => ({
  name: `提取${index}`,
  source: 'body',
  key: '',
  operator: 'equals',
  expected: '',
  assert: false,
});

interface Props {
  apiId: number | null;
  saved: boolean;
}

export default function PreActionSection({ apiId, saved }: Props) {
  const [preActions, setPreActions] = useState<PreAction[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPreActions = async () => {
    if (!apiId) return;
    setLoading(true);
    try {
      const res = await apiFetch<any[]>(`/apis/${apiId}/pre-actions`);
      if (res.code === 200 && res.data) {
        setPreActions(res.data.map((row: any) => ({
          ...row,
          extract_rules: row.extract_rules ? JSON.parse(row.extract_rules) : [],
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiId) loadPreActions();
  }, [apiId, saved]);

  const savePreAction = async (pa: PreAction) => {
    const payload = {
      type: pa.type,
      description: pa.description,
      content: pa.content,
      extract_rules: JSON.stringify(pa.extract_rules),
      sort_order: pa.sort_order,
    };
    if (pa.id) {
      await apiFetch(`/apis/${apiId}/pre-actions/${pa.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      const res = await apiFetch<{ id: number }>(`/apis/${apiId}/pre-actions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.code === 201 && res.data) {
        setPreActions(prev => prev.map(p =>
          p === pa ? { ...pa, id: res.data!.id } : p
        ));
        return;
      }
    }
  };

  const addPreAction = () => {
    setPreActions(prev => [
      ...prev,
      {
        id: undefined,
        api_id: apiId!,
        type: 'script',
        description: '',
        content: '',
        extract_rules: [],
        sort_order: prev.length,
      },
    ]);
  };

  const removePreAction = async (pa: PreAction) => {
    if (pa.id) {
      await apiFetch(`/apis/${apiId}/pre-actions/${pa.id}`, { method: 'DELETE' });
    }
    setPreActions(prev => prev.filter(p => p !== pa));
  };

  const updatePreAction = (index: number, patch: Partial<PreAction>) => {
    setPreActions(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p));
  };

  const addRule = (paIndex: number) => {
    setPreActions(prev => prev.map((p, i) =>
      i === paIndex
        ? { ...p, extract_rules: [...p.extract_rules, defaultRule(p.extract_rules.length + 1)] }
        : p
    ));
  };

  const removeRule = (paIndex: number, ruleIdx: number) => {
    setPreActions(prev => prev.map((p, i) =>
      i === paIndex
        ? { ...p, extract_rules: p.extract_rules.filter((_, ri) => ri !== ruleIdx) }
        : p
    ));
  };

  const updateRule = (paIndex: number, ruleIdx: number, field: keyof AssertionRule, value: any) => {
    setPreActions(prev => prev.map((p, i) =>
      i === paIndex
        ? {
            ...p,
            extract_rules: p.extract_rules.map((r, ri) =>
              ri === ruleIdx ? { ...r, [field]: value } : r
            ),
          }
        : p
    ));
  };

  return (
    <div className="pre-action-section">
      <div className="ad-section-head">
        <label>前置动作</label>
        <button type="button" className="ad-btn ad-btn-sm" onClick={addPreAction}>
          + 添加前置动作
        </button>
      </div>

      {loading && <div className="ad-empty-hint">加载中...</div>}

      {preActions.length === 0 && !loading && (
        <div className="ad-empty-hint">暂无前置动作，点击"添加前置动作"开始配置。</div>
      )}

      {preActions.map((pa, paIdx) => (
        <PreActionCard
          key={paIdx}
          pa={pa}
          paIdx={paIdx}
          onChange={(patch) => updatePreAction(paIdx, patch)}
          onRemove={() => removePreAction(pa)}
          onSave={() => savePreAction(pa)}
          onAddRule={() => addRule(paIdx)}
          onRemoveRule={(ri) => removeRule(paIdx, ri)}
          onUpdateRule={(ri, field, value) => updateRule(paIdx, ri, field, value)}
        />
      ))}
    </div>
  );
}

interface CardProps {
  pa: PreAction;
  paIdx: number;
  onChange: (patch: Partial<PreAction>) => void;
  onRemove: () => void;
  onSave: () => void;
  onAddRule: () => void;
  onRemoveRule: (ruleIdx: number) => void;
  onUpdateRule: (ruleIdx: number, field: keyof AssertionRule, value: any) => void;
}

function PreActionCard({ pa, paIdx, onChange, onRemove, onSave, onAddRule, onRemoveRule, onUpdateRule }: CardProps) {
  const [expanded, setExpanded] = useState(true);
  const editorLang = pa.type === 'database' ? 'sql' : 'javascript';

  return (
    <div className="pre-action-card">
      <div className="pa-card-header">
        <button
          type="button"
          className="pa-toggle-btn"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? '收起' : '展开'}
        >
          <span className={`pa-toggle-icon ${expanded ? 'open' : ''}`}>›</span>
        </button>

        <select
          className="pa-type-select"
          value={pa.type}
          onChange={(e) => onChange({ type: e.target.value as 'script' | 'database' })}
        >
          {PRE_ACTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <input
          className="pa-desc-input"
          placeholder="动作描述（可选）"
          value={pa.description}
          onChange={(e) => onChange({ description: e.target.value })}
          onBlur={onSave}
        />

        <button type="button" className="pa-save-btn" onClick={onSave} title="保存">
          保存
        </button>
        <button type="button" className="ad-btn-del" onClick={onRemove} title="删除">
          ✕
        </button>
      </div>

      {expanded && (
        <div className="pa-card-body">
          <div className="ad-editor-section">
            <div className="ad-editor-label">
              <label>{pa.type === 'database' ? 'SQL 语句' : '脚本内容'}</label>
            </div>
            <CodeMirror
              value={pa.content}
              height="120px"
              extensions={[javascript()]}
              onChange={(val) => onChange({ content: val })}
              onBlur={onSave}
              placeholder={pa.type === 'database' ? 'SELECT * FROM users WHERE id = 1' : '// 输入 JavaScript 脚本'}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            />
          </div>

          {/* Extract rules */}
          <div className="pa-extract-section">
            <div className="ad-section-head">
              <label>提取和检查</label>
              <button type="button" className="ad-btn ad-btn-sm" onClick={onAddRule}>
                + 添加规则
              </button>
            </div>
            {pa.extract_rules.length === 0 && (
              <div className="ad-empty-hint">暂无规则，提取的内容可用于后续接口变量。</div>
            )}
            {pa.extract_rules.map((rule, ri) => (
              <div key={ri} className="pa-rule-card">
                <div className="ad-rule-row">
                  <select
                    value={rule.source}
                    onChange={(e) => onUpdateRule(ri, 'source', e.target.value)}
                  >
                    <option value="body">响应体</option>
                    <option value="status">状态码</option>
                    <option value="header">响应头</option>
                  </select>
                  <input
                    className="ad-rule-key"
                    placeholder={rule.source === 'status' ? '(自动)' : '路径如 data.token'}
                    value={rule.key}
                    onChange={(e) => onUpdateRule(ri, 'key', e.target.value)}
                    disabled={rule.source === 'status'}
                  />

                  <label className="ad-rule-switch">
                    <input
                      type="checkbox"
                      checked={rule.assert !== false}
                      onChange={(e) => onUpdateRule(ri, 'assert', e.target.checked)}
                    />
                    <span className="ad-rule-switch-slider" />
                  </label>

                  {rule.assert !== false && (
                    <>
                      <span className="ad-rule-arrow">→</span>
                      <select
                        value={rule.operator}
                        onChange={(e) => onUpdateRule(ri, 'operator', e.target.value)}
                      >
                        <option value="equals">等于</option>
                        <option value="not_equals">不等于</option>
                        <option value="contains">包含</option>
                        <option value="not_contains">不包含</option>
                        <option value="less_than">小于</option>
                        <option value="greater_than">大于</option>
                        <option value="exists">存在</option>
                        <option value="not_exists">不存在</option>
                      </select>
                      {!['exists', 'not_exists'].includes(rule.operator) && (
                        <input
                          className="ad-rule-expected"
                          placeholder="期望值"
                          value={rule.expected}
                          onChange={(e) => onUpdateRule(ri, 'expected', e.target.value)}
                        />
                      )}
                    </>
                  )}

                  <button type="button" className="ad-btn-del" onClick={() => onRemoveRule(ri)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}