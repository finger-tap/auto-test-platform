import { Router, Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { authMiddleware } from '../auth/middleware.js';
import {
  getMidsceneConfig,
  upsertMidsceneConfig,
  type MidsceneConfigUpdate,
} from '../db/midscene-config.js';
import { applyUserMidsceneConfig } from '../engine/midscene-config.js';
import { clearReportPathCache } from '../engine/report-paths.js';
import { clearMidsceneReportPathCache } from '../midscene-reports-static.js';
import { findUserById } from '../db/users.js';

export const midsceneConfigRoutes = Router();
midsceneConfigRoutes.use(authMiddleware);

// GET /api/midscene-config
// Returns the current user's Midscene model config row. Missing row returns
// a fully-empty default so the UI can bind its form fields without
// conditionals. API keys are NOT masked server-side — the UI shows them
// in a password input that defaults to hidden.
midsceneConfigRoutes.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const row = getMidsceneConfig(userId) || null;
  res.json({ code: 200, message: 'ok', data: row });
});

// PUT /api/midscene-config
// Upserts the current user's row. Empty strings from the UI are mapped to
// null so the applyMidsceneConfig helper skips them. After writing, we
// push the new values into the live Midscene runtime so the very next
// execution picks them up.
midsceneConfigRoutes.put('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = (req.body || {}) as Record<string, unknown>;

  // Empty string → null, number-as-string → number, leave other types alone.
  const normalizeString = (v: unknown): string | null => {
    if (v === undefined) return undefined as unknown as string | null; // not provided
    if (v === null) return null;
    const s = String(v).trim();
    return s.length === 0 ? null : s;
  };
  const normalizeNumber = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const data: MidsceneConfigUpdate = {
    model_name: normalizeString(body.model_name),
    model_api_key: normalizeString(body.model_api_key),
    model_base_url: normalizeString(body.model_base_url),
    model_family: normalizeString(body.model_family),
    model_timeout: normalizeNumber(body.model_timeout),
    model_temperature: body.model_temperature === undefined ? undefined : (Number.isFinite(Number(body.model_temperature)) ? Number(body.model_temperature) : null),
    model_retry_count: normalizeNumber(body.model_retry_count),
    model_retry_interval: normalizeNumber(body.model_retry_interval),
    model_http_proxy: normalizeString(body.model_http_proxy),
    model_socks_proxy: normalizeString(body.model_socks_proxy),
    model_extra_body_json: normalizeString(body.model_extra_body_json),
    model_init_config_json: normalizeString(body.model_init_config_json),
    model_reasoning_enabled: normalizeNumber(body.model_reasoning_enabled),
    model_reasoning_effort: normalizeString(body.model_reasoning_effort),
    model_reasoning_budget: normalizeNumber(body.model_reasoning_budget),
    insight_model_name: normalizeString(body.insight_model_name),
    insight_model_api_key: normalizeString(body.insight_model_api_key),
    insight_model_base_url: normalizeString(body.insight_model_base_url),
    insight_model_family: normalizeString(body.insight_model_family),
    insight_model_timeout: normalizeNumber(body.insight_model_timeout),
    insight_model_temperature: body.insight_model_temperature === undefined ? undefined : (Number.isFinite(Number(body.insight_model_temperature)) ? Number(body.insight_model_temperature) : null),
    insight_model_retry_count: normalizeNumber(body.insight_model_retry_count),
    insight_model_retry_interval: normalizeNumber(body.insight_model_retry_interval),
    insight_model_http_proxy: normalizeString(body.insight_model_http_proxy),
    insight_model_socks_proxy: normalizeString(body.insight_model_socks_proxy),
    insight_model_extra_body_json: normalizeString(body.insight_model_extra_body_json),
    insight_model_init_config_json: normalizeString(body.insight_model_init_config_json),
    insight_model_reasoning_enabled: normalizeNumber(body.insight_model_reasoning_enabled),
    insight_model_reasoning_effort: normalizeString(body.insight_model_reasoning_effort),
    insight_model_reasoning_budget: normalizeNumber(body.insight_model_reasoning_budget),
    planning_model_name: normalizeString(body.planning_model_name),
    planning_model_api_key: normalizeString(body.planning_model_api_key),
    planning_model_base_url: normalizeString(body.planning_model_base_url),
    planning_model_family: normalizeString(body.planning_model_family),
    planning_model_timeout: normalizeNumber(body.planning_model_timeout),
    planning_model_temperature: body.planning_model_temperature === undefined ? undefined : (Number.isFinite(Number(body.planning_model_temperature)) ? Number(body.planning_model_temperature) : null),
    planning_model_retry_count: normalizeNumber(body.planning_model_retry_count),
    planning_model_retry_interval: normalizeNumber(body.planning_model_retry_interval),
    planning_model_http_proxy: normalizeString(body.planning_model_http_proxy),
    planning_model_socks_proxy: normalizeString(body.planning_model_socks_proxy),
    planning_model_extra_body_json: normalizeString(body.planning_model_extra_body_json),
    planning_model_init_config_json: normalizeString(body.planning_model_init_config_json),
    planning_model_reasoning_enabled: normalizeNumber(body.planning_model_reasoning_enabled),
    planning_model_reasoning_effort: normalizeString(body.planning_model_reasoning_effort),
    planning_model_reasoning_budget: normalizeNumber(body.planning_model_reasoning_budget),
    preferred_language: normalizeString(body.preferred_language),
    report_storage_path: normalizeString(body.report_storage_path),
    replanning_cycle_limit: normalizeNumber(body.replanning_cycle_limit),
    wait_after_action: normalizeNumber(body.wait_after_action),
    screenshot_shrink_factor: normalizeNumber(body.screenshot_shrink_factor),
  };

  // 2026-06-06: validate the per-user report storage path before persisting.
  // We require an absolute path with no `..` segments and prove writability
  // by mkdir(recursive). On success, the resolved absolute path is stored
  // (not the raw input) so downstream readers see a canonical form.
  if (data.report_storage_path) {
    const resolved = path.resolve(data.report_storage_path);
    if (!path.isAbsolute(resolved)) {
      return res.status(400).json({ code: 400, message: '报告存储路径必须为绝对路径' });
    }
    if (data.report_storage_path.includes('..') || resolved.includes('..' + path.sep) || resolved.endsWith('..')) {
      return res.status(400).json({ code: 400, message: '报告存储路径不能包含 ..' });
    }
    try {
      await fs.mkdir(resolved, { recursive: true });
      // Write-probe: drop a tiny file and remove it to confirm writability
      // before committing the config. Avoids silent failures where the
      // first execution discovers the directory is read-only.
      const probe = path.join(resolved, `.write-probe-${process.pid}-${Date.now()}`);
      await fs.writeFile(probe, 'ok');
      await fs.rm(probe, { force: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[midscene-config] report_storage_path validation failed: ${msg}`);
      return res.status(400).json({ code: 400, message: `无法创建或写入目录: ${msg}` });
    }
    data.report_storage_path = resolved;
  }

  const updated = upsertMidsceneConfig(userId, data);

  // Invalidate the per-user path caches so the next execution / HTTP
  // request sees the new path immediately (don't wait for the 60s TTL).
  clearReportPathCache(userId);
  clearMidsceneReportPathCache();

  // Push into the live Midscene runtime so the next case picks this up.
  const executor = findUserById(userId);
  const logContext = `saved by ${executor?.account || userId}`;
  try {
    await applyUserMidsceneConfig(userId, logContext);
  } catch (e) {
    // Persistence succeeded; runtime push is best-effort. The next
    // executor call will retry via applyUserMidsceneConfig at case start.
    console.log(`[midscene-config] runtime apply failed (config still saved): ${e instanceof Error ? e.message : String(e)}`);
  }

  res.json({ code: 200, message: 'ok', data: updated });
});
