/**
 * Case set executor — runs multiple test cases sequentially for web/pc/mobile.
 *
 * For each case in a case_set:
 *  1. Write a row to the per-type `*_case_executions` table to track this run.
 *  2. Call the per-type executor (executeWebCase / executePcCase / executeMobileTest).
 *  3. Update the per-case execution row with status / duration / report_path.
 *  4. Update the per-set execution item row (case_set_execution_items_${t}).
 *  5. Continue on per-case failure — single bad case must not abort the loop.
 *
 * Aggregate status:
 *   - 'success' only if every case passed
 *   - 'failed' if any case failed / errored
 *
 * 2026-06-05: replaces the old "scenario_set" runBatch path for web/pc/mobile.
 * API test type keeps the existing scenario_set / runBatch path (unchanged).
 */

import { findSetById as findWebSet } from '../db/case-sets-web.js';
import {
  createCaseSetExecution as createWebSetExec,
  updateCaseSetExecution as updateWebSetExec,
  createCaseSetExecutionItem as createWebSetItem,
  updateCaseSetExecutionItem as updateWebSetItem,
} from '../db/case-sets-web.js';
import { findSetById as findPcSet } from '../db/case-sets-pc.js';
import {
  createCaseSetExecution as createPcSetExec,
  updateCaseSetExecution as updatePcSetExec,
  createCaseSetExecutionItem as createPcSetItem,
  updateCaseSetExecutionItem as updatePcSetItem,
} from '../db/case-sets-pc.js';
import { findSetById as findMobileSet } from '../db/case-sets-mobile.js';
import {
  createCaseSetExecution as createMobileSetExec,
  updateCaseSetExecution as updateMobileSetExec,
  createCaseSetExecutionItem as createMobileSetItem,
  updateCaseSetExecutionItem as updateMobileSetItem,
} from '../db/case-sets-mobile.js';

import { getWebCase } from '../db/web-cases.js';
import {
  createWebCaseExecution,
  finishWebCaseExecution,
} from '../db/web-cases.js';
import { getPcCase } from '../db/pc-cases.js';
import {
  createPcCaseExecution,
  finishPcCaseExecution,
} from '../db/pc-cases.js';
import { findMobileTestById } from '../db/mobile-tests.js';
import {
  createMobileCaseExecution,
  finishMobileCaseExecution,
} from '../db/mobile-tests.js';

import { executeWebCase } from './web-executor.js';
import { executePcCase } from './pc-executor.js';
import { executeMobileTest } from './mobile-executor.js';

export type CaseSetTestType = 'web' | 'pc' | 'mobile';

export interface RunCaseSetResult {
  executionId: number;
  passed: number;
  failed: number;
}

interface CaseSetLike {
  id: number;
  user_id: number;
  test_case_ids: string;
}

interface CaseExecutionRowLike {
  id: number;
}

type CreateCaseExec = (caseId: number, userId: number, data: {
  started_at: string;
  executed_by: string | null;
  device_id?: number | null;
}) => number;

type FinishCaseExec = (id: number, data: {
  status: string;
  finished_at: string;
  duration_ms: number | null;
  report_path: string | null;
  report_type: string | null;
  error_message: string | null;
}) => number;

interface Dispatcher {
  findSet(setId: number): CaseSetLike | undefined;
  findCase(caseId: number): { id: number; name: string } | undefined;
  createCaseExecution: CreateCaseExec;
  finishCaseExecution: FinishCaseExec;
  runCase: (
    testCase: unknown,
    opts: { executedBy: string; caseId: number; execId: number; userId: number }
  ) => Promise<{ status: string; duration_ms: number; report_path?: string; error_message?: string }>;
  createSetExec(setId: number, triggerType: string, executedBy: string, startedAt: string): number;
  updateSetExec(id: number, patch: {
    status: 'running' | 'success' | 'failed';
    total_count?: number;
    passed_count?: number;
    failed_count?: number;
    skipped_count?: number;
    total_duration_ms?: number | null;
    finished_at?: string;
  }): boolean;
  createSetItem(setExecId: number, caseId: number, caseName: string): number;
  updateSetItem(id: number, patch: {
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
    duration_ms?: number | null;
    error_message?: string | null;
    case_execution_id?: number | null;
    report_path?: string | null;
    finished_at?: string;
  }): boolean;
}

function getDispatcher(testType: CaseSetTestType): Dispatcher {
  if (testType === 'web') {
    return {
      findSet: findWebSet,
      findCase: (id) => {
        const r = getWebCase(id);
        return r ? { id: r.id, name: r.name } : undefined;
      },
      createCaseExecution: createWebCaseExecution as CreateCaseExec,
      finishCaseExecution: finishWebCaseExecution as FinishCaseExec,
      runCase: async (testCase, opts) => {
        const r = await executeWebCase(
          testCase as Parameters<typeof executeWebCase>[0],
          opts as Parameters<typeof executeWebCase>[1]
        );
        return {
          status: r.status,
          duration_ms: r.duration_ms,
          report_path: r.report_path,
          error_message: r.error_message,
        };
      },
      createSetExec: createWebSetExec,
      updateSetExec: updateWebSetExec,
      createSetItem: createWebSetItem,
      updateSetItem: updateWebSetItem,
    };
  }
  if (testType === 'pc') {
    return {
      findSet: findPcSet,
      findCase: (id) => {
        const r = getPcCase(id);
        return r ? { id: r.id, name: r.name } : undefined;
      },
      createCaseExecution: createPcCaseExecution as CreateCaseExec,
      finishCaseExecution: finishPcCaseExecution as FinishCaseExec,
      runCase: async (testCase, opts) => {
        const r = await executePcCase(
          testCase as Parameters<typeof executePcCase>[0],
          opts as Parameters<typeof executePcCase>[1]
        );
        return {
          status: r.status,
          duration_ms: r.duration_ms,
          report_path: r.report_path,
          error_message: r.error_message,
        };
      },
      createSetExec: createPcSetExec,
      updateSetExec: updatePcSetExec,
      createSetItem: createPcSetItem,
      updateSetItem: updatePcSetItem,
    };
  }
  // mobile
  return {
    findSet: findMobileSet,
    findCase: (id) => {
      const r = findMobileTestById(id);
      return r ? { id: r.id, name: r.name } : undefined;
    },
    createCaseExecution: createMobileCaseExecution as CreateCaseExec,
    finishCaseExecution: finishMobileCaseExecution as FinishCaseExec,
    runCase: async (testCase, opts) => {
      const r = await executeMobileTest(
        testCase as Parameters<typeof executeMobileTest>[0],
        opts as Parameters<typeof executeMobileTest>[1]
      );
      return {
        status: r.status,
        duration_ms: r.duration_ms,
        report_path: r.report_path,
        error_message: r.error_message,
      };
    },
    createSetExec: createMobileSetExec,
    updateSetExec: updateMobileSetExec,
    createSetItem: createMobileSetItem,
    updateSetItem: updateMobileSetItem,
  };
}

export async function runCaseSet(
  setId: number,
  testType: CaseSetTestType,
  executedBy: string,
  filterCaseIds?: number[]
): Promise<RunCaseSetResult> {
  console.log(`[case-set-executor] start setId=${setId} type=${testType} executor=${executedBy}`);

  const dispatcher = getDispatcher(testType);
  const set = dispatcher.findSet(setId);
  if (!set) throw new Error(`Case set ${setId} not found`);

  let allIds: number[] = [];
  try {
    const parsed = JSON.parse(set.test_case_ids || '[]');
    if (Array.isArray(parsed)) allIds = parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  } catch {
    allIds = [];
  }
  if (allIds.length === 0) throw new Error('No test cases in this set');

  // Apply filter if provided (must be a subset of allIds).
  const caseIds = filterCaseIds && filterCaseIds.length > 0
    ? filterCaseIds.filter((id) => allIds.includes(id))
    : allIds;
  if (caseIds.length === 0) throw new Error('No test cases selected');

  const setStart = new Date().toISOString();
  const setStartMs = Date.now();

  // Create the set-level execution row.
  const setExecutionId = dispatcher.createSetExec(setId, 'manual', executedBy, setStart);
  console.log(`[case-set-executor] setId=${setId} setExecId=${setExecutionId} total=${caseIds.length}`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDuration = 0;

  for (const caseId of caseIds) {
    const testCase = dispatcher.findCase(caseId);
    if (!testCase) {
      console.log(`[case-set-executor] setId=${setId} caseId=${caseId} SKIP (case not found)`);
      const itemId = dispatcher.createSetItem(setExecutionId, caseId, '(deleted case)');
      dispatcher.updateSetItem(itemId, {
        status: 'skipped',
        finished_at: new Date().toISOString(),
        error_message: 'Case not found',
      });
      skipped++;
      continue;
    }

    const itemId = dispatcher.createSetItem(setExecutionId, caseId, testCase.name);
    const caseStartMs = Date.now();
    console.log(`[case-set-executor] setId=${setId} caseId=${caseId} start name="${testCase.name}"`);

    // Create the per-case execution row (so the report / error can be associated
    // with a single case_execution_id, just like running a case standalone).
    const caseExecId = dispatcher.createCaseExecution(caseId, set.user_id, {
      started_at: new Date().toISOString(),
      executed_by: executedBy,
    });

    try {
      // Re-fetch the full case row for the executor (the dispatcher.findCase
      // only returned id+name; the executors need the full row).
      let fullTestCase: unknown = null;
      if (testType === 'web') fullTestCase = getWebCase(caseId);
      else if (testType === 'pc') fullTestCase = getPcCase(caseId);
      else fullTestCase = findMobileTestById(caseId);

      if (!fullTestCase) {
        throw new Error('Case row missing at execution time');
      }

      const result = await dispatcher.runCase(fullTestCase, {
        executedBy,
        caseId,
        execId: caseExecId,
        userId: set.user_id,
      });

      const caseEndMs = Date.now();
      const caseDuration = caseEndMs - caseStartMs;
      // Normalize executor status: 'error' is treated as 'failed' for both
      // the case_executions row (allowed values: running/success/failed)
      // and the case_set_execution_items row (allowed: pending/running/success/failed/skipped).
      const rawStatus = result.status as string;
      const caseStatus: 'success' | 'failed' = rawStatus === 'success' ? 'success' : 'failed';
      totalDuration += result.duration_ms ?? caseDuration;

      // Persist per-case execution row (the *_case_executions table).
      dispatcher.finishCaseExecution(caseExecId, {
        status: caseStatus,
        finished_at: new Date().toISOString(),
        duration_ms: result.duration_ms ?? caseDuration,
        report_path: result.report_path ?? null,
        report_type: result.report_path ? 'midscene-html' : null,
        error_message: result.error_message ?? null,
      });

      if (caseStatus === 'success') passed++;
      else failed++;

      // Persist per-set item row.
      dispatcher.updateSetItem(itemId, {
        status: caseStatus,
        duration_ms: result.duration_ms ?? caseDuration,
        error_message: result.error_message ?? null,
        case_execution_id: caseExecId,
        report_path: result.report_path ?? null,
        finished_at: new Date().toISOString(),
      });

      console.log(
        `[case-set-executor] setId=${setId} caseId=${caseId} end status=${caseStatus} duration=${result.duration_ms ?? caseDuration}ms`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      const caseEndMs = Date.now();
      const caseDuration = caseEndMs - caseStartMs;
      totalDuration += caseDuration;
      failed++;
      console.error(`[case-set-executor] setId=${setId} caseId=${caseId} ERROR duration=${caseDuration}ms err="${errMsg}"`);

      // Best-effort: close the per-case execution row so it doesn't sit at 'running' forever.
      try {
        dispatcher.finishCaseExecution(caseExecId, {
          status: 'error',
          finished_at: new Date().toISOString(),
          duration_ms: caseDuration,
          report_path: null,
          report_type: null,
          error_message: errMsg,
        });
      } catch (closeErr) {
        console.error(`[case-set-executor] setId=${setId} caseId=${caseId} finishCaseExecution threw: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`);
      }

      dispatcher.updateSetItem(itemId, {
        status: 'failed',
        duration_ms: caseDuration,
        error_message: errMsg,
        case_execution_id: caseExecId,
        report_path: null,
        finished_at: new Date().toISOString(),
      });
      // Continue the loop — one bad case must not abort the set.
    }
  }

  const setEndMs = Date.now();
  const setTotalMs = setEndMs - setStartMs;
  const overallStatus: 'success' | 'failed' = failed === 0 ? 'success' : 'failed';
  const finishedAt = new Date().toISOString();

  dispatcher.updateSetExec(setExecutionId, {
    status: overallStatus,
    total_count: caseIds.length,
    passed_count: passed,
    failed_count: failed,
    skipped_count: skipped,
    total_duration_ms: totalDuration,
    finished_at: finishedAt,
  });

  console.log(
    `[case-set-executor] setId=${setId} setExecId=${setExecutionId} done status=${overallStatus} passed=${passed} failed=${failed} skipped=${skipped} total=${setTotalMs}ms`
  );

  return { executionId: setExecutionId, passed, failed };
}
