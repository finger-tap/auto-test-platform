import { useState, useRef } from 'react';
import { useEnvironment } from '../contexts/EnvironmentContext';
import type { EnvVariable } from '../types';

interface VarHoverTipProps {
  text: string;
  className?: string;
}

/**
 * 将 {{var}} 格式的变量高亮（蓝色背景色块），hover 时显示环境变量值。
 * 无变量时也正常显示纯文本。
 */
export default function VarHoverTip({ text, className = '' }: VarHoverTipProps) {
  const { activeEnv } = useEnvironment();
  const [tooltip, setTooltip] = useState<{ content: string } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  if (!text) return <span className="var-hover-wrap"><span className="var-placeholder">点击输入请求地址</span></span>;

  // 解析变量
  const parts: { text: string; isVar: boolean; name?: string }[] = [];
  const hasVar = text.includes('{{');
  if (hasVar) {
    const regex = /\{\{([^}]+)\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index), isVar: false });
      parts.push({ text: m[0], isVar: true, name: m[1].trim() });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), isVar: false });
  } else {
    parts.push({ text, isVar: false });
  }

  function showTip(name: string) {
    const vars: EnvVariable[] = activeEnv?.variables || [];
    const found = vars.find(v => v.key === name);
    const val = found ? found.value : `<未找到: ${name}>`;
    setTooltip({ content: val });
  }

  function hideTip() {
    setTooltip(null);
  }

  return (
    <>
      <span ref={wrapRef} className={`var-hover-wrap ${className}`}>
        {parts.map((p, i) =>
          p.isVar ? (
            <span
              key={i}
              className="var-token"
              onMouseEnter={() => showTip(p.name || '')}
              onMouseLeave={hideTip}
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </span>
      {tooltip && (
        <span
          className="var-tooltip"
          onMouseEnter={() => setTooltip(tooltip)}
          onMouseLeave={hideTip}
        >
          {tooltip.content}
        </span>
      )}
    </>
  );
}