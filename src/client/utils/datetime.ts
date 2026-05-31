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