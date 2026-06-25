import React, { useMemo } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, Decoration, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, highlightActiveLine, rectangularSelection, crosshairCursor, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, acceptCompletion, type CompletionSource } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';

// 类型 re-export:历史调用方仍从 CodeMirrorHover 导入 ParamVar
export type { ParamVar } from '../utils/variableResolver';
import ThemedCodeMirror from './ThemedCodeMirror';
import { useEnvironment } from '../contexts/EnvironmentContext';
import type { EnvVariable } from '../types';
import { normalizeParamVars, resolveVariable, type ParamVar } from '../utils/variableResolver';

// 手动构建 basicSetup（不含内置 autocompletion，避免和自定义的冲突）
const baseEditorSetup: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    // Tab 接受补全:没有补全弹窗时返回 false,fallthrough 到 indentWithTab
    { key: 'Tab', run: acceptCompletion },
    indentWithTab,
  ]),
];

interface CodeMirrorHoverProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  height?: string;
  extensions?: Extension[];
  editable?: boolean;
  onDirty?: () => void;
  /** 传递给 CodeMirror basicSetup */
  basicSetup?: Record<string, unknown>;
  /** 参数化变量(支持 name/desc/values 三段);也兼容老的 string[] 形式 */
  paramHeaders?: ParamVar[] | string[];
}

// ── Built-in function names for autocomplete ──
const BUILTIN_FUNCS = [
  { name: 'upper', desc: '转大写' }, { name: 'lower', desc: '转小写' },
  { name: 'trim', desc: '去空格' }, { name: 'concat', desc: '拼接字符串' },
  { name: 'substring', desc: '截取子串' }, { name: 'replace', desc: '替换' },
  { name: 'split', desc: '分割' }, { name: 'length', desc: '长度' },
  { name: 'contains', desc: '包含' }, { name: 'startsWith', desc: '前缀匹配' },
  { name: 'endsWith', desc: '后缀匹配' },
  { name: 'add', desc: '加法' }, { name: 'sub', desc: '减法' },
  { name: 'mul', desc: '乘法' }, { name: 'div', desc: '除法' },
  { name: 'round', desc: '四舍五入' }, { name: 'floor', desc: '向下取整' },
  { name: 'ceil', desc: '向上取整' },
  { name: 'now', desc: '当前时间' }, { name: 'timestamp', desc: '时间戳' },
  { name: 'dateAdd', desc: '日期加减' }, { name: 'formatDate', desc: '格式化日期' },
  { name: 'base64Encode', desc: 'Base64 编码' }, { name: 'base64Decode', desc: 'Base64 解码' },
  { name: 'urlEncode', desc: 'URL 编码' }, { name: 'urlDecode', desc: 'URL 解码' },
  { name: 'md5', desc: 'MD5 哈希' },
  { name: 'randomInt', desc: '随机整数' }, { name: 'randomFloat', desc: '随机小数' },
  { name: 'randomString', desc: '随机字符串' }, { name: 'randomMobile', desc: '随机手机号' },
  { name: 'randomEmail', desc: '随机邮箱' }, { name: 'randomUUID', desc: '随机 UUID' },
  { name: 'randomChoice', desc: '随机选择' },
  { name: 'jsonGet', desc: 'JSON 取值' }, { name: 'jsonStringify', desc: 'JSON 序列化' },
];

// 从文本中解析出所有 {{var}} 变量名
function extractVarNames(text: string): string[] {
  const names: string[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    names.push(m[1].trim());
  }
  return names;
}

// CodeMirror Extension: 变量 hover tooltip
// 同时支持环境变量({{envVar}})和参数化变量({{paramVar}}),hover 只显示值
const varHoverExtension = (
  getEnvVars: () => EnvVariable[],
  getParams: () => ParamVar[],
) =>
  hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const col = pos - line.from;

    // 在当前行中找 {{...}} 模式
    const regex = /\{\{([^}]+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(lineText)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (col >= start && col <= end) {
        const name = m[1].trim();
        const resolved = resolveVariable(name, getEnvVars(), getParams());

        let tooltipText: string;
        let kind: 'env' | 'param' | 'unknown' = 'unknown';
        if (resolved) {
          tooltipText = resolved.value;
          kind = resolved.kind;
        } else {
          tooltipText = `<未找到: ${name}>`;
        }

        return {
          pos: line.from + start,
          end: line.from + end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = `cm-var-tooltip cm-var-tooltip--${kind}`;
            // 用 white-space: pre-wrap 让 \n 换行
            dom.style.whiteSpace = 'pre-wrap';
            dom.textContent = tooltipText;
            return { dom };
          },
        };
      }
    }
    return null;
  });

// CodeMirror Extension: 变量语法高亮（通过 markDecoration）
const varHighlightExtension = (getEnvVars: () => EnvVariable[]) =>
  EditorView.decorations.compute(['doc'], (state) => {
    const decorations: { from: number; to: number }[] = [];
    const doc = state.doc;

    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const text = line.text;
      const regex = /\{\{([^}]+)\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        decorations.push({ from, to });
      }
    }

    const decos = decorations.map(({ from, to }) =>
      Decoration.mark({ class: 'cm-var-highlight' }).range(from, to)
    );
    return Decoration.set(decos, true);
  });

// CodeMirror Extension: 变量/函数自动补全
// from 必须跳过 `{{` / `${` 前缀,否则 CodeMirror 用 `{{xxx` 作为 filter 字符串,
// 没有候选项能匹配,label 全部被过滤掉,看起来像"补全没触发"
const varCompletionSource = (
  getEnvVars: () => EnvVariable[],
  getParamHeaders: () => ParamVar[],
): CompletionSource => (context) => {
  // 匹配 {{ 后的输入(兼容 closeBrackets 自动补 } 的情况,光标可能在 {{|}})
  const varWord = context.matchBefore(/\{\{[\w]*/);
  if (varWord) {
    const envVars = getEnvVars();
    const paramHeaders = getParamHeaders();

    const varOptions = [
      ...envVars.filter(v => v.enabled !== false).map(v => ({
        label: v.key,
        detail: v.value?.slice(0, 40) || '',
        info: v.description || '',
        type: 'variable' as const,
      })),
      ...paramHeaders.map(h => ({
        label: h.name,
        detail: h.desc || '参数化变量',
        type: 'variable' as const,
      })),
    ];

    return {
      // 跳过 `{{`,让 CodeMirror 用 `{{` 后面的部分作为 filter
      from: varWord.from + 2,
      filter: true,
      options: varOptions,
    };
  }

  // 匹配 ${ 后的函数名
  const funcWord = context.matchBefore(/\$\{[\w]*/);
  if (funcWord) {
    return {
      // 同上,跳过 `${`
      from: funcWord.from + 2,
      filter: true,
      options: BUILTIN_FUNCS.map(f => ({
        label: `${f.name}()`,
        detail: f.desc,
        type: 'function' as const,
        // 自定义 apply:插入 `name(` 而不是 `name()`,让光标停在括号内,
        // 用户接着输入参数 + `)` + `}`(closeBrackets 已经预置了 `}`)
        apply: (view, completion, from, to) => {
          const labelText = String(completion.label);
          const insertText = labelText.endsWith('()') ? labelText.slice(0, -1) : labelText;
          view.dispatch({
            changes: { from, to, insert: insertText },
            selection: { anchor: from + insertText.length },
          });
        },
      })),
    };
  }

  return null;
};

export default function CodeMirrorHover({
  value,
  onChange,
  placeholder,
  height = '200px',
  extensions = [],
  editable = true,
  onDirty,
  basicSetup,
  paramHeaders = [],
}: CodeMirrorHoverProps) {
  const { activeEnv } = useEnvironment();
  const envVars = activeEnv?.variables || [];

  // 规整参数化变量,并缓存。useMemo 保证 paramHeaders 引用变化时才重算
  const normalizedParams = useMemo(() => normalizeParamVars(paramHeaders), [paramHeaders]);

  // 包装函数，用于在 extension 内部访问最新的 envVars / params
  const getEnvVars = () => envVars;
  const getParams = () => normalizedParams;

  // 合并 extensions：基础编辑器 + 变量高亮 + hover + 自动补全 + 语言扩展
  const mergedExtensions = useMemo(() => {
    return [
      ...baseEditorSetup,
      varHighlightExtension(getEnvVars),
      varHoverExtension(getEnvVars, getParams),
      autocompletion({
        override: [varCompletionSource(getEnvVars, getParams)],
        activateOnTyping: true,
      }),
      ...extensions,
    ];
  }, [extensions, envVars, normalizedParams]);

  const handleChange = (val: string) => {
    onChange?.(val);
    onDirty?.();
  };

  return (
    <ThemedCodeMirror
      value={value}
      height={height}
      extensions={mergedExtensions}
      onChange={handleChange}
      placeholder={placeholder}
      editable={editable}
      basicSetup={false}
    />
  );
}

// 预设扩展：JSON 格式化 + lint
export function jsonExtensions(placeholder?: string): Extension[] {
  return [json()];
}

// 预设扩展：JavaScript
export function jsExtensions(): Extension[] {
  return [javascript()];
}
