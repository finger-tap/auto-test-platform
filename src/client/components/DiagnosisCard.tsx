import { useState } from 'react';
import { diagnose, type DiagnoseInput } from '../../shared/diagnose-rules';

/**
 * 执行异常诊断卡片 (2026-08-29)。
 *
 * 放在失败执行记录详情区顶部: 主诊断(原因+分步建议)默认展开,
 * 次要可能折叠; 一键复制全文便于贴给同事/提 bug。
 * 诊断由 shared/diagnose-rules 纯函数实时计算 — 规则迭代后历史记录同样受益。
 */

export default function DiagnosisCard({ input }: { input: DiagnoseInput }) {
  const [showOthers, setShowOthers] = useState(false);
  const [copied, setCopied] = useState(false);
  const advices = diagnose(input);

  if (advices.length === 0) return null;
  const [main, ...others] = advices;

  const copyAll = async () => {
    const text = [
      `诊断: ${main.title}`,
      `原因: ${main.reason}`,
      '建议:',
      ...main.suggestions.map((s, i) => `${i + 1}. ${s}`),
      ...(others.length > 0 ? ['', '其他可能:', ...others.map(o => `- ${o.title}: ${o.reason}`)] : []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const tone = main.severity === 'error' ? 'danger' : 'warning';

  return (
    <div
      className="diagnosis-card"
      style={{
        border: `1px solid var(--${tone}-subtle)`,
        borderLeft: `3px solid var(--${tone})`,
        background: `var(--${tone}-subtle)`,
        borderRadius: 'var(--radius-md, 8px)',
        padding: '10px 14px',
        marginBottom: 10,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span aria-hidden>🔍</span>
        <strong style={{ color: `var(--${tone})`, flex: 1 }}>诊断：{main.title}</strong>
        <button
          type="button"
          onClick={copyAll}
          style={{
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-secondary)',
            fontSize: 11, padding: '1px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <div style={{ color: 'var(--fg-secondary)', marginBottom: 6 }}>{main.reason}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {main.suggestions.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: `var(--${tone})`, fontWeight: 600, flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ color: 'var(--fg)' }}>{s}</span>
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setShowOthers(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--fg-tertiary)', fontSize: 12, cursor: 'pointer', padding: 0 }}
          >
            其他可能 ({others.length}) {showOthers ? '▴' : '▾'}
          </button>
          {showOthers && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {others.map(o => (
                <div key={o.code} style={{ borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  <div style={{ fontWeight: 600, color: 'var(--fg-secondary)' }}>{o.title}</div>
                  <div style={{ color: 'var(--fg-tertiary)', fontSize: 12 }}>{o.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-tertiary)' }}>※ 规则库自动诊断，仅供参考</div>
    </div>
  );
}
