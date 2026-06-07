import { getWebBrowserConfig, type WebBrowserConfigRow } from '../db/web-browser-config.js';

// The resolved launch options that the web executor uses for a single case.
// Derived from the user's web_browser_config row (default) — per-case
// overrides are NOT supported anymore (per user decision: full migration
// to per-user config).
export interface ResolvedBrowserConfig {
  driver_path: string | null;
  user_data_dir: string | null;
  accept_downloads: boolean;
  download_dir: string | null;
  auto_download: boolean;
  executable_path: string | null;
  chromium_sandbox: boolean;
  close_browser_after_execution: boolean;
  keep_context_alive: boolean;
  default_timeout_ms: number | null;
}

const rowToResolved = (row: WebBrowserConfigRow | undefined): ResolvedBrowserConfig => ({
  driver_path: row?.driver_path?.trim() || null,
  user_data_dir: row?.user_data_dir?.trim() || null,
  accept_downloads: row?.accept_downloads === 1,
  download_dir: row?.download_dir?.trim() || null,
  auto_download: row?.auto_download === 1,
  executable_path: row?.executable_path?.trim() || null,
  chromium_sandbox: row?.chromium_sandbox === 1,
  close_browser_after_execution: row?.close_browser_after_execution === 1,
  keep_context_alive: row?.keep_context_alive === 1,
  default_timeout_ms: row?.default_timeout_ms ?? null,
});

// Load the user's web_browser_config row and return a ResolvedBrowserConfig.
// Logs the resolved values (with secrets masked) so the executor's call site
// has clear visibility into what config is being used.
export async function applyUserWebBrowserConfig(
  userId: number,
  logContext: string,
): Promise<ResolvedBrowserConfig> {
  let row: WebBrowserConfigRow | undefined;
  try {
    row = getWebBrowserConfig(userId);
  } catch (e) {
    console.log(`[executor:web] ${logContext} web-browser-config load failed: ${e instanceof Error ? e.message : String(e)}`);
    row = undefined;
  }
  const resolved = rowToResolved(row);
  // Compact log: which fields are set, never their values. Skip null/false
  // for brevity. The log line lets the executor trace "why did the browser
  // launch with these options?" without needing to inspect code paths.
  const parts: string[] = [];
  if (resolved.driver_path) parts.push(`driver_path`);
  if (resolved.user_data_dir) parts.push(`user_data_dir`);
  if (resolved.accept_downloads) parts.push(`accept_downloads=true`);
  if (resolved.download_dir) parts.push(`download_dir`);
  if (resolved.auto_download) parts.push(`auto_download=true`);
  if (resolved.executable_path) parts.push(`executable_path`);
  if (resolved.chromium_sandbox) parts.push(`chromium_sandbox=true`);
  if (resolved.close_browser_after_execution) parts.push(`close_browser=true`);
  if (resolved.keep_context_alive) parts.push(`keep_context_alive=true`);
  if (resolved.default_timeout_ms != null) parts.push(`default_timeout_ms=${resolved.default_timeout_ms}`);
  console.log(`[executor:web] ${logContext} web-browser-config ${row ? 'hit' : 'miss(no-row)'} ${parts.length ? 'set=[' + parts.join(',') + ']' : 'set=[]'}`);
  return resolved;
}
