import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  getWebBrowserConfig,
  upsertWebBrowserConfig,
  type WebBrowserConfigUpdate,
} from '../db/web-browser-config.js';

export const webBrowserConfigRoutes = Router();
webBrowserConfigRoutes.use(authMiddleware);

// GET /api/web-browser-config
// Returns the current user's per-user web_browser_config row, or null
// if the user has not saved one yet (UI falls back to empty form).
webBrowserConfigRoutes.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const row = getWebBrowserConfig(userId) || null;
  res.json({ code: 200, message: 'ok', data: row });
});

// PUT /api/web-browser-config
// Upserts the current user's row. Empty strings from the UI are mapped to
// null so the resolve helper can skip them. Numeric fields are coerced;
// booleans come in as true/false from the UI and are mapped to 0/1.
webBrowserConfigRoutes.put('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = (req.body || {}) as Record<string, unknown>;

  const normalizeString = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim();
    return s.length === 0 ? null : s;
  };
  const normalizeBool = (v: unknown): 0 | 1 | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
  };
  const normalizeNumber = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const data: WebBrowserConfigUpdate = {
    driver_path: normalizeString(body.driver_path),
    user_data_dir: normalizeString(body.user_data_dir),
    accept_downloads: normalizeBool(body.accept_downloads),
    download_dir: normalizeString(body.download_dir),
    auto_download: normalizeBool(body.auto_download),
    executable_path: normalizeString(body.executable_path),
    chromium_sandbox: normalizeBool(body.chromium_sandbox),
    close_browser_after_execution: normalizeBool(body.close_browser_after_execution),
    keep_context_alive: normalizeBool(body.keep_context_alive),
    default_timeout_ms: normalizeNumber(body.default_timeout_ms),
  };

  const updated = upsertWebBrowserConfig(userId, data);
  res.json({ code: 200, message: 'ok', data: updated });
});
