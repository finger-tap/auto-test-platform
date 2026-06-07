// Bridge between the per-user `midscene_config` DB row and Midscene's
// process-level `overrideAIConfig()` API. The web/pc/mobile executors call
// `applyUserMidsceneConfig(userId)` at the start of each case so the
// AI calls use that user's model. After upserting the row from the API
// route, we also call `applyUserMidsceneConfig` so the next case picks
// up the change immediately without waiting for a server restart.

import { getMidsceneConfig, type MidsceneConfigRow } from '../db/midscene-config.js';

// Lazy import to avoid pulling Midscene's module-level globals at server
// startup. We only need them when an actual execution starts.
type OverrideFn = (
  newConfig: Record<string, string>,
  extendMode?: boolean,
) => void;
let _overrideAIConfig: OverrideFn | null = null;
async function getOverrideAIConfig(): Promise<OverrideFn> {
  if (_overrideAIConfig) return _overrideAIConfig;
  // `@midscene/web/playwright` re-exports overrideAIConfig from
  // @midscene/shared/env. Using the web entry so we don't need to add a
  // direct dependency on @midscene/shared.
  const mod = await import('@midscene/web/playwright');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _overrideAIConfig = (mod as any).overrideAIConfig as OverrideFn;
  return _overrideAIConfig;
}

/**
 * Build the env-var map Midscene expects from a stored config row. Empty
 * strings and null are skipped so a half-filled row doesn't override
 * values that were deliberately left at defaults.
 */
function buildEnvMap(row: MidsceneConfigRow): Record<string, string> {
  const m: Record<string, string> = {};
  const setIfPresent = (key: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (s.length === 0) return;
    m[key] = s;
  };
  // Default intent
  setIfPresent('MIDSCENE_MODEL_NAME', row.model_name);
  setIfPresent('MIDSCENE_MODEL_API_KEY', row.model_api_key);
  setIfPresent('MIDSCENE_MODEL_BASE_URL', row.model_base_url);
  setIfPresent('MIDSCENE_MODEL_FAMILY', row.model_family);
  setIfPresent('MIDSCENE_MODEL_TIMEOUT', row.model_timeout);
  setIfPresent('MIDSCENE_MODEL_TEMPERATURE', row.model_temperature);
  // Insight intent
  setIfPresent('MIDSCENE_INSIGHT_MODEL_NAME', row.insight_model_name);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_API_KEY', row.insight_model_api_key);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_BASE_URL', row.insight_model_base_url);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_FAMILY', row.insight_model_family);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_TIMEOUT', row.insight_model_timeout);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_TEMPERATURE', row.insight_model_temperature);
  // Planning intent
  setIfPresent('MIDSCENE_PLANNING_MODEL_NAME', row.planning_model_name);
  setIfPresent('MIDSCENE_PLANNING_MODEL_API_KEY', row.planning_model_api_key);
  setIfPresent('MIDSCENE_PLANNING_MODEL_BASE_URL', row.planning_model_base_url);
  setIfPresent('MIDSCENE_PLANNING_MODEL_FAMILY', row.planning_model_family);
  setIfPresent('MIDSCENE_PLANNING_MODEL_TIMEOUT', row.planning_model_timeout);
  setIfPresent('MIDSCENE_PLANNING_MODEL_TEMPERATURE', row.planning_model_temperature);
  // Preferences
  setIfPresent('MIDSCENE_PREFERRED_LANGUAGE', row.preferred_language);
  return m;
}

/**
 * Push the user's Midscene config to the live Midscene runtime. Safe to
 * call with a missing/empty row — it just clears the override. Uses
 * `extendMode: true` so any leftover env-var-set values (e.g. OPENAI_API_KEY
 * from a Docker secret) are preserved unless the user explicitly set them.
 */
export async function applyUserMidsceneConfig(userId: number, logContext: string): Promise<void> {
  const row = getMidsceneConfig(userId);
  const envMap = row ? buildEnvMap(row) : {};
  const override = await getOverrideAIConfig();
  // No row → wipe override. Midscene will fall back to process.env.
  if (!row) {
    console.log(`[midscene-config] ${logContext} user=${userId} no config row, clearing override`);
    override({}, true);
    return;
  }
  // Mask the API key in the log so we don't leak secrets into dev logs.
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(envMap)) {
    masked[k] = k.includes('API_KEY') ? `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})` : v;
  }
  console.log(`[midscene-config] ${logContext} user=${userId} applying ${Object.keys(envMap).length} keys: ${JSON.stringify(masked)}`);
  override(envMap, true);
}
