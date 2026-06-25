import type { EnvVariable } from '../types';

/**
 * 变量解析相关共享逻辑。
 * 三处消费:
 *  - components/CodeMirrorHover.tsx (CodeMirror 编辑器内的 hover tooltip + 自动补全)
 *  - components/VarHoverTip.tsx    (列表页等只读场景的变量高亮 + hover)
 *  - components/VariableAutocomplete.tsx (URL 输入框的 {{ 补全)
 *
 * 解析顺序约定:环境变量优先 → 参数化变量 → "未找到"。
 */

// 参数化变量;name 必填,desc/values 可选(取自参数化表格)
export interface ParamVar {
  name: string;
  desc?: string;
  values?: string[];
}

// 参数化配置的存储结构,与 apis.parameters 列里 JSON 字符串对齐
export interface ParamConfig {
  enabled?: boolean;
  headers: string[];
  headerDescs?: string[];
  rows: string[][];
  enabledRows?: boolean[];
}

// 解析 parameters JSON 字符串;空/损坏/格式不对都返回 null(不抛异常)
export function parseParamConfig(raw?: string | null): ParamConfig | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || !Array.isArray(obj.headers) || !Array.isArray(obj.rows)) return null;
    return obj as ParamConfig;
  } catch {
    return null;
  }
}

// 老格式 paramHeaders 可能是 string[],新格式是 ParamVar[];统一规整
export function normalizeParamVars(input: ParamVar[] | string[] | undefined): ParamVar[] {
  if (!input) return [];
  return input.map(item => (typeof item === 'string' ? { name: item } : item));
}

// 把 ParamConfig 展平成 ParamVar[];每列一个,values 是该列在所有启用行中的非空值
export function buildParamVars(cfg: ParamConfig): ParamVar[] {
  return cfg.headers
    .map((name, i): ParamVar => {
      const values = cfg.rows
        .map(row => row[i] ?? '')
        .filter((v, ri) => v !== '' && cfg.enabledRows?.[ri] !== false);
      return { name, desc: cfg.headerDescs?.[i] || '', values };
    })
    .filter(p => p.name);
}

// 参数化变量的预览值:单值直返,多值显示"首个 · 共 N 个值",空值回退到描述或提示文本
export function previewParamValue(v: ParamVar): string {
  const values = (v.values || []).filter(x => x !== '');
  if (values.length === 0) return v.desc || '参数化变量（暂无样本值）';
  if (values.length === 1) return values[0];
  return `${values[0]} · 共 ${values.length} 个值`;
}

// 单步解析:name 先在 envVars 中找,找不到再去 params 中找;都 miss 返回 null
export function resolveVariable(
  name: string,
  envVars: EnvVariable[],
  params: ParamVar[],
): { value: string; kind: 'env' | 'param' } | null {
  const envFound = envVars.find(v => v.key === name && v.enabled !== false);
  if (envFound) return { value: envFound.value, kind: 'env' };

  const paramFound = params.find(p => p.name === name);
  if (paramFound) return { value: previewParamValue(paramFound), kind: 'param' };

  return null;
}

// 一站式:从 parameters JSON 字符串直接拿到 ParamVar[];解析失败返回 []
// 注意:不按 enabled 短路 — 预览/hover 时无论是否启用都展示变量值,与 ApiDetail
// 内部的 paramVars 构建行为一致(执行时才看 enabled)
export function parseParamVars(parameters?: string | null): ParamVar[] {
  const cfg = parseParamConfig(parameters);
  if (!cfg) return [];
  return buildParamVars(cfg);
}
