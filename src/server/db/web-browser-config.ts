import db from './index.js';

// Per-user Web browser configuration. One row per user. Stores the
// Playwright launch / context options that apply to all of this user's
// web test cases (driver path, user data dir, accept downloads, etc.).
// The web executor reads this row at case-start and merges the values
// into the launch options.
export interface WebBrowserConfigRow {
  user_id: number;
  driver_path: string | null;
  user_data_dir: string | null;
  accept_downloads: 0 | 1;
  download_dir: string | null;
  auto_download: 0 | 1;
  executable_path: string | null;
  chromium_sandbox: 0 | 1;
  close_browser_after_execution: 0 | 1;
  keep_context_alive: 0 | 1;
  default_timeout_ms: number | null;
  created_at: string;
  updated_at: string;
}

// Update payload: every field is optional (PATCH-style). `null` clears the
// field; `undefined` leaves it alone. The route normalizes empty strings
// from the UI to null so we can use null-skipping semantics here.
export interface WebBrowserConfigUpdate {
  driver_path?: string | null;
  user_data_dir?: string | null;
  accept_downloads?: 0 | 1 | null;
  download_dir?: string | null;
  auto_download?: 0 | 1 | null;
  executable_path?: string | null;
  chromium_sandbox?: 0 | 1 | null;
  close_browser_after_execution?: 0 | 1 | null;
  keep_context_alive?: 0 | 1 | null;
  default_timeout_ms?: number | null;
}

export function getWebBrowserConfig(userId: number): WebBrowserConfigRow | undefined {
  return db.prepare('SELECT * FROM web_browser_config WHERE user_id = ?').get(userId) as WebBrowserConfigRow | undefined;
}

export function upsertWebBrowserConfig(userId: number, data: WebBrowserConfigUpdate): WebBrowserConfigRow {
  const existing = getWebBrowserConfig(userId);
  if (!existing) {
    db.prepare(`
      INSERT INTO web_browser_config (
        user_id,
        driver_path, user_data_dir, accept_downloads, download_dir, auto_download,
        executable_path, chromium_sandbox, close_browser_after_execution,
        keep_context_alive, default_timeout_ms,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        datetime('now', '+8 hours'), datetime('now', '+8 hours')
      )
    `).run(
      userId,
      data.driver_path ?? null,
      data.user_data_dir ?? null,
      (data.accept_downloads ?? 0) as 0 | 1,
      data.download_dir ?? null,
      (data.auto_download ?? 0) as 0 | 1,
      data.executable_path ?? null,
      (data.chromium_sandbox ?? 0) as 0 | 1,
      (data.close_browser_after_execution ?? 0) as 0 | 1,
      (data.keep_context_alive ?? 0) as 0 | 1,
      data.default_timeout_ms ?? null,
    );
  } else {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now', '+8 hours')");
      values.push(userId);
      db.prepare(`UPDATE web_browser_config SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    }
  }
  return getWebBrowserConfig(userId)!;
}
