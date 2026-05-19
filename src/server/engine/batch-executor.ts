/**
 * Batch execution engine — runs multiple scenarios sequentially.
 * Reports progress and results per scenario.
 */

import { findSetById, type ScenarioSetRow } from '../db/scenario-sets.js';
import { findScenarioById } from '../db/scenarios.js';
import { executeScenario } from './executor.js';

export interface BatchScenarioResult {
  scenario_id: number;
  scenario_name: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number | null;
  error_message?: string | null;
  node_summary?: { passed: number; failed: number; total: number };
}

export interface BatchReport {
  set_id: number;
  set_name: string;
  total: number;
  passed: number;
  failed: number;
  total_duration_ms: number;
  scenarios: BatchScenarioResult[];
  executed_at: string;
  executed_by: string;
}

export interface BatchLogRow {
  id: number;
  set_id: number;
  report: string; // JSON string of BatchReport
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string;
  executed_at: string;
}

export async function runBatch(setId: number, executedBy: string, environmentId?: number): Promise<BatchReport> {
  const set = findSetById(setId);
  if (!set) throw new Error('Scenario set not found');

  let scenarioIds: number[] = [];
  try {
    scenarioIds = JSON.parse(set.scenario_ids || '[]');
  } catch {
    scenarioIds = [];
  }

  if (scenarioIds.length === 0) throw new Error('No scenarios in this set');

  const results: BatchScenarioResult[] = [];
  let totalDuration = 0;
  let passed = 0;
  let failed = 0;

  for (const scenarioId of scenarioIds) {
    const scenario = findScenarioById(scenarioId);
    if (!scenario) {
      results.push({
        scenario_id: scenarioId,
        scenario_name: '(deleted scenario)',
        status: 'skipped',
        duration_ms: null,
        error_message: 'Scenario not found',
      });
      continue;
    }

    try {
      const result = await executeScenario(scenarioId, executedBy, environmentId);

      // Parse node results to summarize
      let nodePassed = 0, nodeFailed = 0;
      if (result.node_results) {
        try {
          const nodeResults = JSON.parse(result.node_results);
          for (const [, nr] of Object.entries(nodeResults as Record<string, { status: string }>)) {
            if (nr.status === 'success') nodePassed++;
            else if (nr.status === 'failed' || nr.status === 'error') nodeFailed++;
          }
        } catch { /* ignore */ }
      }

      const status = result.status as 'success' | 'failed';
      if (status === 'success') passed++;
      else failed++;

      results.push({
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status,
        duration_ms: result.duration_ms ?? null,
        error_message: result.error_message ?? null,
        node_summary: { passed: nodePassed, failed: nodeFailed, total: nodePassed + nodeFailed },
      });

      totalDuration += result.duration_ms ?? 0;
    } catch (err) {
      failed++;
      results.push({
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        status: 'failed',
        duration_ms: null,
        error_message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const report: BatchReport = {
    set_id: setId,
    set_name: set.name,
    total: scenarioIds.length,
    passed,
    failed,
    total_duration_ms: totalDuration,
    scenarios: results,
    executed_at: new Date().toISOString(),
    executed_by: executedBy,
  };

  return report;
}