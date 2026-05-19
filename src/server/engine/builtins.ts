/**
 * Built-in functions for variable transformation and data generation.
 * Available in all contexts: API headers, body, assertions, condition expressions.
 */

export interface BuiltinContext {
  timestamp?: string;
  [key: string]: string | undefined;
}

// ── String functions ─────────────────────────────────────

export function _upper(str: string): string {
  return String(str || '').toUpperCase();
}

export function _lower(str: string): string {
  return String(str || '').toLowerCase();
}

export function _trim(str: string): string {
  return String(str || '').trim();
}

export function _concat(...args: string[]): string {
  return args.join('');
}

export function _substring(str: string, start: number, end?: number): string {
  const s = String(str || '');
  return end !== undefined ? s.substring(start, end) : s.substring(start);
}

export function _replace(str: string, search: string, replacement: string): string {
  return String(str || '').split(search).join(replacement);
}

export function _split(str: string, delimiter: string, index?: number): string {
  const parts = String(str || '').split(delimiter);
  if (index !== undefined) return parts[index] || '';
  return parts.join(delimiter); // no index → join back
}

export function _length(str: string): number {
  return String(str || '').length;
}

export function _contains(str: string, search: string): boolean {
  return String(str || '').includes(search);
}

export function _startsWith(str: string, prefix: string): boolean {
  return String(str || '').startsWith(prefix);
}

export function _endsWith(str: string, suffix: string): boolean {
  return String(str || '').endsWith(suffix);
}

// ── Number functions ──────────────────────────────────────

export function _add(a: string | number, b: string | number): number {
  return Number(a) + Number(b);
}

export function _sub(a: string | number, b: string | number): number {
  return Number(a) - Number(b);
}

export function _mul(a: string | number, b: string | number): number {
  return Number(a) * Number(b);
}

export function _div(a: string | number, b: string | number): number {
  return Number(b) === 0 ? 0 : Number(a) / Number(b);
}

export function _round(num: string | number, decimals = 0): number {
  const factor = Math.pow(10, Number(decimals));
  return Math.round(Number(num) * factor) / factor;
}

export function _floor(num: string | number): number {
  return Math.floor(Number(num));
}

export function _ceil(num: string | number): number {
  return Math.ceil(Number(num));
}

export function _min(...nums: (string | number)[]): number {
  return Math.min(...nums.map(Number));
}

export function _max(...nums: (string | number)[]): number {
  return Math.max(...nums.map(Number));
}

// ── Date / Time functions ─────────────────────────────────

export function _now(format?: string): string {
  const d = new Date();
  if (!format) return d.toISOString();
  return formatDate(d, format);
}

export function _timestamp(): string {
  return String(Date.now());
}

export function _dateAdd(unit: string, amount: number, base?: string): string {
  const d = base ? new Date(base) : new Date();
  const u = unit.toLowerCase();
  if (u === 'year' || u === 'y') d.setFullYear(d.getFullYear() + amount);
  else if (u === 'month' || u === 'm') d.setMonth(d.getMonth() + amount);
  else if (u === 'day' || u === 'd') d.setDate(d.getDate() + amount);
  else if (u === 'hour' || u === 'h') d.setHours(d.getHours() + amount);
  else if (u === 'minute' || u === 'min') d.setMinutes(d.getMinutes() + amount);
  else if (u === 'second' || u === 's') d.setSeconds(d.getSeconds() + amount);
  else if (u === 'millisecond' || u === 'ms') d.setMilliseconds(d.getMilliseconds() + amount);
  return d.toISOString();
}

export function _formatDate(dateStr: string, format: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return formatDate(d, format);
  } catch {
    return dateStr;
  }
}

function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return fmt
    .replace('YYYY', String(d.getFullYear()))
    .replace('YY', String(d.getFullYear()).slice(-2))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()))
    .replace('SSS', pad(d.getMilliseconds(), 3));
}

// ── Encoding functions ─────────────────────────────────────

export function _base64Encode(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return ''; }
}

export function _base64Decode(str: string): string {
  try { return decodeURIComponent(escape(atob(str))); } catch { return ''; }
}

export function _md5(str: string): string {
  // Simple MD5 placeholder — in production, use crypto module
  return `md5:${str}`;
}

export function _urlEncode(str: string): string {
  return encodeURIComponent(str);
}

export function _urlDecode(str: string): string {
  return decodeURIComponent(str);
}

// ── Random data generation ────────────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NUMBERS = '0123456789';

export function _randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function _randomFloat(min: number, max: number, decimals = 2): number {
  const r = Math.random() * (max - min) + min;
  return Number(r.toFixed(Number(decimals)));
}

export function _randomString(length: number, charset?: string): string {
  const chars = charset || CHARS;
  let result = '';
  for (let i = 0; i < Number(length); i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function _randomMobile(): string {
  const prefixes = ['130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
    '150', '151', '152', '153', '155', '156', '157', '158', '159',
    '180', '181', '182', '183', '184', '185', '186', '187', '188', '189'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] + _randomString(8, NUMBERS);
}

export function _randomEmail(): string {
  const name = _randomString(8).toLowerCase();
  const domains = ['qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com'];
  return `${name}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

export function _randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function _randomChoice(...args: string[]): string {
  return args[Math.floor(Math.random() * args.length)] || '';
}

// ── JSON helpers ──────────────────────────────────────────

export function _jsonGet(jsonStr: string, path: string): string {
  try {
    const obj = JSON.parse(jsonStr);
    let val: unknown = obj;
    for (const seg of path.split('.')) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[seg];
      else return '';
    }
    return val !== undefined ? String(val) : '';
  } catch {
    return '';
  }
}

export function _jsonStringify(obj: unknown): string {
  try { return JSON.stringify(obj); } catch { return ''; }
}

// ── Builtin registry ─────────────────────────────────────

export const BUILTINS: Record<string, (...args: unknown[]) => unknown> = {
  upper: _upper as (...args: unknown[]) => unknown,
  lower: _lower as (...args: unknown[]) => unknown,
  trim: _trim as (...args: unknown[]) => unknown,
  concat: _concat as (...args: unknown[]) => unknown,
  substring: _substring as (...args: unknown[]) => unknown,
  replace: _replace as (...args: unknown[]) => unknown,
  split: _split as (...args: unknown[]) => unknown,
  length: _length as (...args: unknown[]) => unknown,
  contains: _contains as (...args: unknown[]) => unknown,
  startsWith: _startsWith as (...args: unknown[]) => unknown,
  endsWith: _endsWith as (...args: unknown[]) => unknown,
  add: _add as (...args: unknown[]) => unknown,
  sub: _sub as (...args: unknown[]) => unknown,
  mul: _mul as (...args: unknown[]) => unknown,
  div: _div as (...args: unknown[]) => unknown,
  round: _round as (...args: unknown[]) => unknown,
  floor: _floor as (...args: unknown[]) => unknown,
  ceil: _ceil as (...args: unknown[]) => unknown,
  min: _min as (...args: unknown[]) => unknown,
  max: _max as (...args: unknown[]) => unknown,
  now: _now as (...args: unknown[]) => unknown,
  timestamp: _timestamp as (...args: unknown[]) => unknown,
  dateAdd: _dateAdd as (...args: unknown[]) => unknown,
  formatDate: _formatDate as (...args: unknown[]) => unknown,
  base64Encode: _base64Encode as (...args: unknown[]) => unknown,
  base64Decode: _base64Decode as (...args: unknown[]) => unknown,
  md5: _md5 as (...args: unknown[]) => unknown,
  urlEncode: _urlEncode as (...args: unknown[]) => unknown,
  urlDecode: _urlDecode as (...args: unknown[]) => unknown,
  randomInt: _randomInt as (...args: unknown[]) => unknown,
  randomFloat: _randomFloat as (...args: unknown[]) => unknown,
  randomString: _randomString as (...args: unknown[]) => unknown,
  randomMobile: _randomMobile as (...args: unknown[]) => unknown,
  randomEmail: _randomEmail as (...args: unknown[]) => unknown,
  randomUUID: _randomUUID as (...args: unknown[]) => unknown,
  randomChoice: _randomChoice as (...args: unknown[]) => unknown,
  jsonGet: _jsonGet as (...args: unknown[]) => unknown,
  jsonStringify: _jsonStringify as (...args: unknown[]) => unknown,
};

/**
 * Evaluate a function expression in text.
 * Supports: ${funcName(arg1, arg2)}
 * Example: ${randomUUID()} → "a1b2c3d4-..."
 *          ${upper(user_name)} → "JOHN DOE"
 */
export function evalBuiltin(text: string, context?: Record<string, string>): string {
  if (!text) return text;

  // First, substitute {{variable}} placeholders
  let result = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context && context[key] !== undefined ? String(context[key]) : text;
  });

  // Then evaluate ${funcName(...)} expressions
  const funcPattern = /\$\{([a-zA-Z_]\w*)\(([^)]*)\)\}/g;
  result = result.replace(funcPattern, (_, funcName, argsStr) => {
    const fn = BUILTINS[funcName];
    if (!fn) return text; // unknown function → return original

    // Parse args (handle quoted strings)
    const args = parseArgs(argsStr);

    try {
      const ret = fn(...args);
      return ret !== undefined ? String(ret) : '';
    } catch {
      return text;
    }
  });

  return result;
}

function parseArgs(argsStr: string): unknown[] {
  if (!argsStr.trim()) return [];
  const args: unknown[] = [];
  let i = 0;
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  while (i < argsStr.length) {
    const ch = argsStr[i];
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = true;
      quoteChar = ch;
      i++;
      continue;
    }
    if (ch === quoteChar && inQuote) {
      args.push(current);
      current = '';
      inQuote = false;
      quoteChar = '';
      i++;
      // skip comma
      while (i < argsStr.length && (argsStr[i] === ' ' || argsStr[i] === ',')) i++;
      continue;
    }
    if (ch === ',' && !inQuote) {
      if (current.trim()) args.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (current.trim()) {
    // Try to parse as number
    const num = Number(current.trim());
    args.push(isNaN(num) ? current.trim() : num);
  }

  return args;
}