import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, Decoration } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { useEnvironment } from '../contexts/EnvironmentContext';
import type { EnvVariable } from '../types';

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
}

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

// 获取环境中变量的当前值
function resolveVarValue(name: string, envVars: EnvVariable[]): string | null {
  const found = envVars.find(v => v.key === name);
  return found ? found.value : null;
}

// CodeMirror Extension: 变量 hover tooltip
const varHoverExtension = (getEnvVars: () => EnvVariable[]) =>
  hoverTooltip((view, pos) => {
    // 找到 pos 所在位置的变量名
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
        const envVars = getEnvVars();
        const value = resolveVarValue(name, envVars);
        const tooltipText = value !== null ? value : `<未找到: ${name}>`;
        return {
          pos: line.from + start,
          end: line.from + end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-var-tooltip';
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

export default function CodeMirrorHover({
  value,
  onChange,
  placeholder,
  height = '200px',
  extensions = [],
  editable = true,
  onDirty,
  basicSetup,
}: CodeMirrorHoverProps) {
  const { activeEnv } = useEnvironment();
  const envVars = activeEnv?.variables || [];

  // 包装函数，用于在 extension 内部访问最新的 envVars
  const getEnvVars = () => envVars;

  // 合并 extensions，包含变量高亮 + hover
  const mergedExtensions = useMemo(() => {
    return [
      varHighlightExtension(getEnvVars),
      varHoverExtension(getEnvVars),
      ...extensions,
    ];
  }, [extensions, envVars]);

  const handleChange = (val: string) => {
    onChange?.(val);
    onDirty?.();
  };

  return (
    <CodeMirror
      value={value}
      height={height}
      extensions={mergedExtensions}
      onChange={handleChange}
      placeholder={placeholder}
      editable={editable}
      basicSetup={basicSetup}
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
