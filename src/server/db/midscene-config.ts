import db from './index.js';

// Per-user Midscene model configuration. One row per user, with separate
// sections for the default / insight / planning intents. The web/pc/mobile
// executors call Midscene's `overrideAIConfig()` with the user's row before
// each case so changes take effect on the next execution without a server
// restart.
export interface MidsceneConfigRow {
  user_id: number;
  model_name: string | null;
  model_api_key: string | null;
  model_base_url: string | null;
  model_family: string | null;
  model_timeout: number | null;
  model_temperature: number | null;
  insight_model_name: string | null;
  insight_model_api_key: string | null;
  insight_model_base_url: string | null;
  insight_model_family: string | null;
  insight_model_timeout: number | null;
  insight_model_temperature: number | null;
  planning_model_name: string | null;
  planning_model_api_key: string | null;
  planning_model_base_url: string | null;
  planning_model_family: string | null;
  planning_model_timeout: number | null;
  planning_model_temperature: number | null;
  preferred_language: string | null;
  // 2026-06-06: absolute filesystem path to a directory where this user's
  // Midscene execution reports should be written. null = use the server's
  // default REPORTS_ROOT (data/midscene-reports). Edited via MidsceneConfig
  // page; consumed by report-paths.ts:generateReportPath() and the dynamic
  // /midscene-reports/* static middleware.
  report_storage_path: string | null;
  created_at: string;
  updated_at: string;
}

// Update payload: every field is optional (PATCH-style). `null` clears the
// field; `undefined` leaves it alone. Use empty string to clear in practice
// (UI sends '' for cleared fields and we map to null on save).
export interface MidsceneConfigUpdate {
  model_name?: string | null;
  model_api_key?: string | null;
  model_base_url?: string | null;
  model_family?: string | null;
  model_timeout?: number | null;
  model_temperature?: number | null;
  insight_model_name?: string | null;
  insight_model_api_key?: string | null;
  insight_model_base_url?: string | null;
  insight_model_family?: string | null;
  insight_model_timeout?: number | null;
  insight_model_temperature?: number | null;
  planning_model_name?: string | null;
  planning_model_api_key?: string | null;
  planning_model_base_url?: string | null;
  planning_model_family?: string | null;
  planning_model_timeout?: number | null;
  planning_model_temperature?: number | null;
  preferred_language?: string | null;
  report_storage_path?: string | null;
}

export function getMidsceneConfig(userId: number): MidsceneConfigRow | undefined {
  return db.prepare('SELECT * FROM midscene_config WHERE user_id = ?').get(userId) as MidsceneConfigRow | undefined;
}

export function upsertMidsceneConfig(userId: number, data: MidsceneConfigUpdate): MidsceneConfigRow {
  const existing = getMidsceneConfig(userId);
  if (!existing) {
    db.prepare(`
      INSERT INTO midscene_config (
        user_id,
        model_name, model_api_key, model_base_url, model_family, model_timeout, model_temperature,
        insight_model_name, insight_model_api_key, insight_model_base_url, insight_model_family, insight_model_timeout, insight_model_temperature,
        planning_model_name, planning_model_api_key, planning_model_base_url, planning_model_family, planning_model_timeout, planning_model_temperature,
        preferred_language,
        report_storage_path,
        created_at, updated_at
      ) VALUES (
        ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?,
        ?,
        datetime('now', '+8 hours'), datetime('now', '+8 hours')
      )
    `).run(
      userId,
      data.model_name ?? null,
      data.model_api_key ?? null,
      data.model_base_url ?? null,
      data.model_family ?? null,
      data.model_timeout ?? null,
      data.model_temperature ?? null,
      data.insight_model_name ?? null,
      data.insight_model_api_key ?? null,
      data.insight_model_base_url ?? null,
      data.insight_model_family ?? null,
      data.insight_model_timeout ?? null,
      data.insight_model_temperature ?? null,
      data.planning_model_name ?? null,
      data.planning_model_api_key ?? null,
      data.planning_model_base_url ?? null,
      data.planning_model_family ?? null,
      data.planning_model_timeout ?? null,
      data.planning_model_temperature ?? null,
      data.preferred_language ?? null,
      data.report_storage_path ?? null,
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
      db.prepare(`UPDATE midscene_config SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    }
  }
  return getMidsceneConfig(userId)!;
}
