/**
 * Batch execution engine — runs multiple scenarios sequentially.
 * Reports progress and results per scenario.
 */

import { findSetById } from '../db/scenario-sets.js';
import {
  createScenarioSetExecution,
  createScenarioSetExecutionItem,
  updateScenarioSetExecution,
  type ScenarioSetExecutionRow,
  type ScenarioSetExecutionItemRow,
} from '../db/scenarios.js';
import { findScenarioById } from '../db/scenarios.js';
import { executeScenario } from './executor.js';

export async function runBatch(
  setId: number,
  executedBy: string,
  environmentId?: number,
  filterScenarioIds?: number[]
): Promise<ScenarioSetExecutionRow & { items: ScenarioSetExecutionItemRow[] }> {
  const set = findSetById(setId);
  if (!set) throw new Error('Scenario set not found');

  let allIds: number[] = [];
  try { allIds = JSON.parse(set.scenario_ids || '[]'); } catch { allIds = []; }
  if (allIds.length === 0) throw new Error('No scenarios in this set');

  // If filter provided, only run those scenarios (must be in the set)
  const scenarioIds = filterScenarioIds
    ? filterScenarioIds.filter(id => allIds.includes(id))
    : allIds;
  if (scenarioIds.length === 0) throw new Error('No scenarios selected');

  const startedAt = new Date().toISOString();

  // Create scenario set execution record
  const setExecutionId = createScenarioSetExecution({
    set_id: setId,
    status: 'running',
    trigger_type: 'manual',
    executed_by: executedBy,
    total_count: scenarioIds.length,
    started_at: startedAt,
    finished_at: startedAt,
  });

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDuration = 0;
  const items: ScenarioSetExecutionItemRow[] = [];

  for (const scenarioId of scenarioIds) {
    const scenario = findScenarioById(scenarioId);
    if (!scenario) {
      createScenarioSetExecutionItem({
        set_execution_id: setExecutionId,
        scenario_id: scenarioId,
        scenario_name: '(deleted scenario)',
        status: 'skipped',
      });
      skipped++;
      continue;
    }

    try {
      const result = await executeScenario(scenarioId, executedBy, environmentId);

      const status = result.status as 'success' | 'failed' | 'error';
      if (status === 'success') passed++;
      else failed++;

      totalDuration += result.duration_ms ?? 0;

      const itemId = createScenarioSetExecutionItem({
        set_execution_id: setExecutionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status,
        duration_ms: result.duration_ms ?? null,
        error_message: result.error_message ?? null,
        scenario_execution_id: result.id,
      });

      items.push({
        id: itemId,
        set_execution_id: setExecutionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status,
        duration_ms: result.duration_ms ?? null,
        error_message: result.error_message ?? null,
        scenario_execution_id: result.id,
      });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const itemId = createScenarioSetExecutionItem({
        set_execution_id: setExecutionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status: 'failed',
        error_message: msg,
      });
      items.push({
        id: itemId,
        set_execution_id: setExecutionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status: 'failed',
        duration_ms: null,
        error_message: msg,
        scenario_execution_id: null,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const overallStatus = failed === 0 ? 'success' : 'failed';

  updateScenarioSetExecution(setExecutionId, {
    status: overallStatus,
    passed_count: passed,
    failed_count: failed,
    skipped_count: skipped,
    total_duration_ms: totalDuration,
    finished_at: finishedAt,
  });

  return {
    id: setExecutionId,
    set_id: setId,
    status: overallStatus,
    trigger_type: 'manual',
    executed_by: executedBy,
    total_count: scenarioIds.length,
    passed_count: passed,
    failed_count: failed,
    skipped_count: skipped,
    total_duration_ms: totalDuration,
    started_at: startedAt,
    finished_at: finishedAt,
    items,
  };
}