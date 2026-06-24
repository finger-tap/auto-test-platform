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
 *
 * 2026-06-14: each intent now emits the extended env vars
 * (RETRY_COUNT / RETRY_INTERVAL / HTTP_PROXY / SOCKS_PROXY /
 * EXTRA_BODY_JSON / INIT_CONFIG_JSON / REASONING_*) in addition to the
 * base NAME/API_KEY/BASE_URL/FAMILY/TIMEOUT/TEMPERATURE.
 */
function buildEnvMap(row: MidsceneConfigRow): Record<string, string> {
  const m: Record<string, string> = {};
  const setIfPresent = (key: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (s.length === 0) return;
    m[key] = s;
  };
  // reasoning_enabled is stored as 0/1 INTEGER; emit 'true'/'false' string.
  const setReasoningEnabled = (key: string, v: number | null | undefined) => {
    if (v === null || v === undefined) return;
    m[key] = v ? 'true' : 'false';
  };
  // Default intent
  setIfPresent('MIDSCENE_MODEL_NAME', row.model_name);
  setIfPresent('MIDSCENE_MODEL_API_KEY', row.model_api_key);
  setIfPresent('MIDSCENE_MODEL_BASE_URL', row.model_base_url);
  setIfPresent('MIDSCENE_MODEL_FAMILY', row.model_family);
  setIfPresent('MIDSCENE_MODEL_TIMEOUT', row.model_timeout);
  setIfPresent('MIDSCENE_MODEL_TEMPERATURE', row.model_temperature);
  setIfPresent('MIDSCENE_MODEL_RETRY_COUNT', row.model_retry_count);
  setIfPresent('MIDSCENE_MODEL_RETRY_INTERVAL', row.model_retry_interval);
  setIfPresent('MIDSCENE_MODEL_HTTP_PROXY', row.model_http_proxy);
  setIfPresent('MIDSCENE_MODEL_SOCKS_PROXY', row.model_socks_proxy);
  setIfPresent('MIDSCENE_MODEL_EXTRA_BODY_JSON', row.model_extra_body_json);
  setIfPresent('MIDSCENE_MODEL_INIT_CONFIG_JSON', row.model_init_config_json);
  setReasoningEnabled('MIDSCENE_MODEL_REASONING_ENABLED', row.model_reasoning_enabled);
  setIfPresent('MIDSCENE_MODEL_REASONING_EFFORT', row.model_reasoning_effort);
  setIfPresent('MIDSCENE_MODEL_REASONING_BUDGET', row.model_reasoning_budget);
  // Insight intent
  setIfPresent('MIDSCENE_INSIGHT_MODEL_NAME', row.insight_model_name);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_API_KEY', row.insight_model_api_key);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_BASE_URL', row.insight_model_base_url);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_FAMILY', row.insight_model_family);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_TIMEOUT', row.insight_model_timeout);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_TEMPERATURE', row.insight_model_temperature);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_RETRY_COUNT', row.insight_model_retry_count);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_RETRY_INTERVAL', row.insight_model_retry_interval);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_HTTP_PROXY', row.insight_model_http_proxy);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_SOCKS_PROXY', row.insight_model_socks_proxy);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_EXTRA_BODY_JSON', row.insight_model_extra_body_json);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_INIT_CONFIG_JSON', row.insight_model_init_config_json);
  setReasoningEnabled('MIDSCENE_INSIGHT_MODEL_REASONING_ENABLED', row.insight_model_reasoning_enabled);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_REASONING_EFFORT', row.insight_model_reasoning_effort);
  setIfPresent('MIDSCENE_INSIGHT_MODEL_REASONING_BUDGET', row.insight_model_reasoning_budget);
  // Planning intent
  setIfPresent('MIDSCENE_PLANNING_MODEL_NAME', row.planning_model_name);
  setIfPresent('MIDSCENE_PLANNING_MODEL_API_KEY', row.planning_model_api_key);
  setIfPresent('MIDSCENE_PLANNING_MODEL_BASE_URL', row.planning_model_base_url);
  setIfPresent('MIDSCENE_PLANNING_MODEL_FAMILY', row.planning_model_family);
  setIfPresent('MIDSCENE_PLANNING_MODEL_TIMEOUT', row.planning_model_timeout);
  setIfPresent('MIDSCENE_PLANNING_MODEL_TEMPERATURE', row.planning_model_temperature);
  setIfPresent('MIDSCENE_PLANNING_MODEL_RETRY_COUNT', row.planning_model_retry_count);
  setIfPresent('MIDSCENE_PLANNING_MODEL_RETRY_INTERVAL', row.planning_model_retry_interval);
  setIfPresent('MIDSCENE_PLANNING_MODEL_HTTP_PROXY', row.planning_model_http_proxy);
  setIfPresent('MIDSCENE_PLANNING_MODEL_SOCKS_PROXY', row.planning_model_socks_proxy);
  setIfPresent('MIDSCENE_PLANNING_MODEL_EXTRA_BODY_JSON', row.planning_model_extra_body_json);
  setIfPresent('MIDSCENE_PLANNING_MODEL_INIT_CONFIG_JSON', row.planning_model_init_config_json);
  setReasoningEnabled('MIDSCENE_PLANNING_MODEL_REASONING_ENABLED', row.planning_model_reasoning_enabled);
  setIfPresent('MIDSCENE_PLANNING_MODEL_REASONING_EFFORT', row.planning_model_reasoning_effort);
  setIfPresent('MIDSCENE_PLANNING_MODEL_REASONING_BUDGET', row.planning_model_reasoning_budget);
  // Preferences
  setIfPresent('MIDSCENE_PREFERRED_LANGUAGE', row.preferred_language);
  // Execution behavior — replanning_cycle_limit is also readable by the
  // agent via MIDSCENE_REPLANNING_CYCLE_LIMIT env (backward-compat path).
  setIfPresent('MIDSCENE_REPLANNING_CYCLE_LIMIT', row.replanning_cycle_limit);
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

/**
 * 2026-06-14: Resolve the user's execution-behavior overrides into a partial
 * AgentOpt bag that the web/pc/mobile executors spread into the agent
 * constructor. Keys are omitted when the row value is null so Midscene falls
 * back to its built-in defaults (replanningCycleLimit=20, waitAfterAction=300,
 * screenshotShrinkFactor=1).
 *
 * `replanningCycleLimit` is surfaced both here AND via the env var above;
 * the constructor arg takes precedence per Midscene source.
 */
export interface AgentOptOverrides {
  replanningCycleLimit?: number;
  waitAfterAction?: number;
  screenshotShrinkFactor?: number;
}

export function getAgentOptOverrides(userId: number | undefined | null): AgentOptOverrides {
  if (!userId) return {};
  const row = getMidsceneConfig(userId);
  if (!row) return {};
  const o: AgentOptOverrides = {};
  if (row.replanning_cycle_limit != null && Number.isFinite(row.replanning_cycle_limit)) {
    o.replanningCycleLimit = row.replanning_cycle_limit;
  }
  if (row.wait_after_action != null && Number.isFinite(row.wait_after_action)) {
    o.waitAfterAction = row.wait_after_action;
  }
  if (row.screenshot_shrink_factor != null && Number.isFinite(row.screenshot_shrink_factor)) {
    o.screenshotShrinkFactor = row.screenshot_shrink_factor;
  }
  return o;
}
