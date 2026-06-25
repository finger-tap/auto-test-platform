import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEnvironment } from '../contexts/EnvironmentContext';
import type { EnvVariable } from '../types';
import { parseParamVars, resolveVariable, type ParamVar } from '../utils/variableResolver';

interface VarHoverTipProps {
  text: string;
  /** 参数化配置的 JSON 字符串(来自 apis.parameters 列);为空/解析失败则忽略 */
  parameters?: string | null;
  className?: string;
}

interface TooltipState {
  content: string;
  x: number;
  y: number;
  // 屏幕上半段 → 'bottom'(tooltip 在鼠标下方);下半段 → 'top'(在鼠标上方)
  side: 'top' | 'bottom';
}

// 鼠标光标与 tooltip 之间的留白,避免遮住光标
const TOOLTIP_OFFSET = 14;

/**
 * 将 {{var}} 格式的变量高亮(蓝色背景色块),hover 时显示变量的当前值。
 * 解析顺序:环境变量 → 参数化变量 → "<未找到: name>"。
 * Tooltip 跟随鼠标位置,根据鼠标在屏幕的上下半段自动选择弹出方向。
 *
 * 变量解析逻辑与 CodeMirrorHover / VariableAutocomplete 共用 variableResolver util,
 * 保证编辑器、URL 输入框、只读展示场景的 hover/补全行为一致。
 */
export default function VarHoverTip({ text, parameters, className = '' }: VarHoverTipProps) {
  const { activeEnv } = useEnvironment();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // 解析参数化变量;依赖 parameters 字符串,变更时重算
  const paramVars: ParamVar[] = useMemo(() => parseParamVars(parameters), [parameters]);

  if (!text) return <span className="var-hover-wrap"><span className="var-placeholder">点击输入请求地址</span></span>;

  // 解析 {{var}} token
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

  function showTip(e: React.MouseEvent, name: string) {
    const envVars: EnvVariable[] = activeEnv?.variables || [];
    const resolved = resolveVariable(name, envVars, paramVars);
    // 鼠标在屏幕上半段 → tooltip 弹在下方;下半段 → 弹在上方,避免被视口边界截断
    const side: 'top' | 'bottom' = e.clientY < window.innerHeight / 2 ? 'bottom' : 'top';
    setTooltip({
      content: resolved?.value ?? `<未找到: ${name}>`,
      x: e.clientX,
      y: e.clientY,
      side,
    });
  }

  function hideTip() {
    setTooltip(null);
  }

  // tooltip 的位置:水平居中于鼠标(向左偏半个宽度,由 CSS transform 完成);
  // 垂直:side='bottom' 时光标下方,side='top' 时光标上方
  const tooltipStyle: React.CSSProperties = tooltip
    ? {
      left: tooltip.x,
      top: tooltip.side === 'bottom' ? tooltip.y + TOOLTIP_OFFSET : tooltip.y - TOOLTIP_OFFSET,
    }
    : {};

  return (
    <>
      <span ref={wrapRef} className={`var-hover-wrap ${className}`}>
        {parts.map((p, i) =>
          p.isVar ? (
            <span
              key={i}
              className="var-token"
              onMouseEnter={(e) => showTip(e, p.name || '')}
              onMouseLeave={hideTip}
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </span>
      {tooltip && createPortal(
        <span
          className={`var-tooltip var-tooltip--${tooltip.side}`}
          style={tooltipStyle}
          role="tooltip"
        >
          {tooltip.content}
        </span>,
        document.body
      )}
    </>
  );
}
