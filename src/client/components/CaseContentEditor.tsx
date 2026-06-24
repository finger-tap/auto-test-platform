import { useMemo } from 'react';
import type { Extension } from '@codemirror/state';
import ThemedCodeMirror from './ThemedCodeMirror';

export type CaseContentType = 'text' | 'yaml';

type Props = {
  value: string;
  type: CaseContentType;
  onChange: (value: string) => void;
  onTypeChange: (type: CaseContentType) => void;
  height?: string;
  readOnly?: boolean;
};

const TEXT_PLACEHOLDER = `在此处用自然语言描述测试步骤，整段内容会交给 AI 自动执行，例如：

1. 打开首页
2. 点击右上角的"登录"按钮
3. 输入用户名和密码
4. 校验登录后能看到"工作台"菜单`;

const YAML_PLACEHOLDER = `# 使用 Midscene YAML 流程语法
# 完整文档：https://midscenejs.com/zh/automate-with-scripts-in-yaml.html

tasks:
  - name: 登录并校验
    flow:
      - ai: 打开首页
      - aiAction: 点击右上角的登录按钮
      - aiInput: admin
        locate: 用户名输入框
      - aiInput: "123456"
        locate: 密码输入框
      - aiAction: 点击登录
      - aiAssert: 顶部能看到"工作台"`;

export function CaseContentEditor({
  value,
  type,
  onChange,
  onTypeChange,
  height = '420px',
  readOnly = false,
}: Props) {
  const extensions = useMemo<Extension[]>(() => {
    // YAML 暂未引入专用语法高亮扩展，保留扩展槽以便后续接入 @codemirror/lang-yaml
    return [];
  }, [type]);

  const placeholder = type === 'yaml' ? YAML_PLACEHOLDER : TEXT_PLACEHOLDER;
  const isEmpty = !value || value.trim().length === 0;

  return (
    <div className="case-content-editor">
      <div
        className="case-content-editor__toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`tab-btn ${type === 'text' ? 'tab-btn--active' : ''}`}
            disabled={readOnly}
            onClick={() => onTypeChange('text')}
            style={tabBtnStyle(type === 'text', readOnly)}
          >
            自然语言
          </button>
          <button
            type="button"
            className={`tab-btn ${type === 'yaml' ? 'tab-btn--active' : ''}`}
            disabled={readOnly}
            onClick={() => onTypeChange('yaml')}
            style={tabBtnStyle(type === 'yaml', readOnly)}
          >
            YAML 流程
          </button>
        </div>
        <div style={{ color: 'var(--fg-tertiary)', fontSize: 12 }}>
          {type === 'yaml'
            ? '执行时调用 Midscene runYaml()'
            : '执行时调用 Midscene aiAct() — 整段文本由 AI 解读执行'}
        </div>
      </div>

      <ThemedCodeMirror
        value={isEmpty ? '' : value}
        height={height}
        placeholder={placeholder}
        extensions={extensions}
        editable={!readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: type === 'yaml',
          autocompletion: type === 'yaml',
        }}
      />
    </div>
  );
}

function tabBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--fg)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontSize: 13,
  };
}
