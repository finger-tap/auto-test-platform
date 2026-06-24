/**
 * Convert ISO datetime string to local Chinese format: "2026-05-30 17:13:14"
 */
export function toLocalDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  } catch {
    return isoString.slice(0, 19).replace('T', ' ');
  }
}

/**
 * Convert ISO datetime string to local Chinese date: "2026-05-30"
 */
export function toLocalDate(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  } catch {
    return isoString.slice(0, 10);
  }
}

/**
 * Format datetime for use in non-React contexts (e.g., template strings, innerHTML)
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  } catch {
    return isoString.slice(0, 19).replace('T', ' ');
  }
}

/**
 * Format milliseconds to human-readable duration.
 *   123       → "123ms"
 *   1234      → "1.2s"
 *   12345     → "12.3s"
 *   62345     → "1m 2s"
 *   3723450   → "1h 2m"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}