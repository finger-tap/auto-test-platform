// Shared NL step migration utilities for all browser/desktop/mobile executors.
// Steps normalize to: { description: string, expect?: string }.
// Accepts legacy 11-action format (action + desc) used by web/pc, and legacy
// 10-action format (action + target) used by mobile.
//
// As of 2026-06-04: cases are no longer a list of typed NL steps. They are
// raw text (one natural-language task) or YAML (Midscene flow syntax). The
// executor hands the whole content to Midscene's `aiAct` (text) or
// `runYaml` (yaml) — no per-line parsing in user code.
//
// This module now only handles:
//   - legacy `steps` JSON → text rendering (for old rows still in DB)
//   - legacy → new field migration helper

export interface NLStep {
  description: string;
  expect?: string;
}

export interface OldStep {
  action: string;
  desc?: string;
  target?: string;
  value?: string;
  direction?: string;
}

export type AnyStep = NLStep | OldStep;

// Default assertion actions shared by web + pc executors.
const WEB_PC_ASSERTION_ACTIONS = new Set(['断言', '检查页面跳转', '检查文本', '检查元素']);

// Mobile assertion actions (from old mobile 10-action set).
// Includes both Chinese + English action names because the existing mobile
// executor's action switch uses English names ('assert', 'checkElement',
// 'checkText'), while the UI historically used Chinese. Covering both lets
// us migrate any historical test_script JSON to NL without losing semantics.
const MOBILE_ASSERTION_ACTIONS = new Set([
  '断言', '检查元素', '检查文本',
  'assert', 'checkElement', 'checkText',
]);

export function isOldStep(s: unknown): s is OldStep {
  if (!s || typeof s !== 'object') return false;
  const obj = s as any;
  return typeof obj.action === 'string' && (
    typeof obj.desc === 'string' ||
    typeof obj.target === 'string' ||
    typeof obj.value === 'string' ||
    typeof obj.direction === 'string'
  );
}

/**
 * Migrate a single step from the legacy {action, desc/target} format to NL.
 * The action type is preserved as a human-readable prefix unless it's an
 * assertion/check action — in that case, the desc/target becomes `expect`.
 */
export function migrateStep(s: AnyStep, assertionActions: Set<string> = WEB_PC_ASSERTION_ACTIONS): NLStep {
  if (!isOldStep(s)) {
    const result: NLStep = { description: s.description };
    if (s.expect) result.expect = s.expect;
    return result;
  }
  const action = (s.action || '').trim();
  const target = (s.target || s.desc || '').trim();
  if (assertionActions.has(action)) {
    return target ? { description: '', expect: target } : { description: '' };
  }
  // Non-assertion: combine action + target/value as a NL description
  const value = (s.value || '').trim();
  const description = action
    ? value ? `${action} ${target} (值: ${value})` : `${action} ${target}`.trim()
    : target;
  return { description };
}

export function parseNLSteps(
  json: string | null | undefined,
  assertionActions?: Set<string>
): NLStep[] {
  if (!json) return [];
  let raw: unknown[];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    raw = parsed;
  } catch {
    return [];
  }
  return raw
    .map((s) => migrateStep(s as AnyStep, assertionActions))
    .filter((s) => s.description || s.expect);
}

export const MOBILE_ASSERTS = MOBILE_ASSERTION_ACTIONS;
export const WEB_PC_ASSERTS = WEB_PC_ASSERTION_ACTIONS;

// Mobile executor 仍走 10-action switch。前端保存 NL,executor 在执行时
// 把 NL 拆回 10-action 格式。
// 规则:
//   - expect 非空 → {action: 'assert', target: expect}
//   - description 第一个 token 匹配 MOBILE_ACTIONS → {action: token, target: 剩余}
//   - 否则 → {action: 'tap', target: description} 兜底
export const MOBILE_ACTIONS = new Set([
  'launch', 'tap', 'input', 'swipe', 'scroll',
  'screenshot', 'assert', 'back', 'home', 'sleep',
]);

export interface MobileActionStep {
  action: string;
  target?: string;
  value?: string;
  duration?: number;
  direction?: string;
}

export function nlStepToMobileAction(step: NLStep): MobileActionStep {
  if (step.expect) {
    return { action: 'assert', target: step.expect };
  }
  const desc = step.description.trim();
  if (!desc) {
    return { action: 'tap', target: '' };
  }
  const spaceIdx = desc.search(/\s/);
  const head = spaceIdx === -1 ? desc : desc.slice(0, spaceIdx);
  const tail = spaceIdx === -1 ? '' : desc.slice(spaceIdx + 1).trim();
  if (MOBILE_ACTIONS.has(head)) {
    return { action: head, target: tail };
  }
  return { action: 'tap', target: desc };
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy → new field migration (2026-06-04)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Render a list of NLStep as plain text. The new "case_content" text format
 * uses one description per line; lines with `期望: <expect>` carry the
 * assertion. The executor passes the whole string to `agent.aiAct` and lets
 * Midscene do the parsing.
 */
export function nlStepsToText(steps: NLStep[]): string {
  return steps
    .map(s => (s.expect ? `${s.description}\n期望: ${s.expect}` : s.description))
    .filter(s => s.trim().length > 0)
    .join('\n');
}

/**
 * Compute the (content, type) pair the executor should hand to Midscene.
 * Prefers the new `case_content` column; falls back to a text rendering of
 * the legacy `steps` JSON column so old rows still execute.
 */
export function resolveCaseContent(
  caseContent: string | null | undefined,
  caseContentType: string | null | undefined,
  legacyStepsJson: string | null | undefined
): { content: string; type: 'text' | 'yaml' } {
  if (caseContent && caseContent.trim().length > 0) {
    return {
      content: caseContent,
      type: caseContentType === 'yaml' ? 'yaml' : 'text',
    };
  }
  const legacy = parseNLSteps(legacyStepsJson);
  if (legacy.length > 0) {
    return { content: nlStepsToText(legacy), type: 'text' };
  }
  return { content: '', type: 'text' };
}

/**
 * As of 2026-06-04: preconditions is a single natural-language string passed
 * to Midscene's `aiAct` (action — set up the state). Old rows store a JSON
 * array of NLStep objects (semantics: assertions) — flatten their
 * descriptions into a single text so existing rows still execute.
 */
export function resolvePreconditionText(
  stored: string | null | undefined
): string {
  if (!stored || !stored.trim()) return '';
  // New format: plain text — return as-is.
  if (!stored.trimStart().startsWith('[')) return stored;
  // Legacy: JSON array of NLStep — extract descriptions.
  const legacy = parseNLSteps(stored);
  if (legacy.length === 0) return stored;
  return nlStepsToText(legacy);
}
