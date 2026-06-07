// Mobile test executor - Android/iOS automation via Midscene
// Reference: @midscene/android, @midscene/ios
//
// DEVIATION FROM PLAN (2026-06-03, updated 2026-06-04):
//   The plan (Phase 4) calls for a full NL-only rewrite of mobile-executor
//   and the addition of HarmonyAgent support via `@midscene/harmony`.
//   The 10-action switch is kept for legacy `test_script` rows saved before
//   2026-06-04. New rows use the new `case_content` column — text is passed
//   to Midscene's `aiAct`, YAML to `runYaml`, the same as the web/pc
//   executors. The full NL rewrite + HarmonyAgent integration remain
//   deferred to a follow-up phase where an actual Android/iOS device is
//   available to verify no UI automation regression.

import { agentFromAdbDevice, AndroidAgent } from '@midscene/android';
import { agentFromWebDriverAgent, IOSAgent, checkIOSEnvironment } from '@midscene/ios';
import type { MobileTestCaseRow } from '../db/mobile-tests.js';
import {
  parseNLSteps,
  resolveCaseContent,
  resolvePreconditionText,
  nlStepToMobileAction,
  type NLStep,
} from './nl-steps.js';
import { applyUserMidsceneConfig } from './midscene-config.js';

export interface StepResult {
  action: string;
  target?: string;
  value?: string;
  direction?: string;
  duration?: number;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  screenshot?: string;
}

export interface ExecuteResult {
  status: 'success' | 'failed' | 'error';
  duration_ms: number;
  steps: StepResult[];
  screenshots: string[];
  error_message?: string;
  report_path?: string;
}

export interface ExecuteOptions {
  executedBy: string;
  environmentId?: number;
  deviceId?: number;
  // The owning user's id — used to load that user's Midscene model config
  // before each case so model / API key changes take effect immediately.
  userId?: number;
}

// Test step definition (stored as JSON in test_script)
export interface TestStep {
  action: string;
  target?: string;
  value?: string;
  duration?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
}

async function executeAndroidStep(
  agent: AndroidAgent,
  step: TestStep
): Promise<StepResult> {
  const start = Date.now();

  try {
    switch (step.action) {
      case 'launch': {
        const target = step.target || step.value || '';
        await agent.launch(target);
        return { action: step.action, target, status: 'success', duration_ms: Date.now() - start };
      }

      case 'tap': {
        await agent.aiTap(step.target || 'click target', {});
        return { action: step.action, target: step.target, status: 'success', duration_ms: Date.now() - start };
      }

      case 'input': {
        const text = step.value || '';
        // Use aiInput to input text - AI will find the right input field
        await agent.aiInput(text, { value: text });
        return { action: step.action, target: step.target, value: text, status: 'success', duration_ms: Date.now() - start };
      }

      case 'swipe': {
        const direction = step.direction || 'up';
        const distance = step.duration || 300;
        if (direction === 'up') {
          await agent.aiScroll(undefined, { direction: 'up', distance });
        } else if (direction === 'down') {
          await agent.aiScroll(undefined, { direction: 'down', distance });
        } else if (direction === 'left') {
          await agent.aiScroll(undefined, { direction: 'left', distance });
        } else if (direction === 'right') {
          await agent.aiScroll(undefined, { direction: 'right', distance });
        }
        return { action: step.action, direction: step.direction, status: 'success', duration_ms: Date.now() - start };
      }

      case 'scroll': {
        const direction = step.direction || 'up';
        const distance = step.duration || 300;
        await agent.aiScroll(undefined, { direction, distance });
        return { action: step.action, direction: step.direction, status: 'success', duration_ms: Date.now() - start };
      }

      case 'back': {
        await agent.back();
        return { action: step.action, status: 'success', duration_ms: Date.now() - start };
      }

      case 'home': {
        await agent.home();
        return { action: step.action, status: 'success', duration_ms: Date.now() - start };
      }

      case 'screenshot': {
        const result = await (agent as any).page.screenshot();
        return { action: step.action, status: 'success', duration_ms: Date.now() - start, screenshot: result.toString('base64') };
      }

      case 'assert': {
        const result = await agent.aiAssert(step.value || step.target || 'check condition');
        if (result?.pass) {
          return { action: step.action, target: step.target, status: 'success', duration_ms: Date.now() - start };
        } else {
          return {
            action: step.action,
            target: step.target,
            status: 'failed',
            duration_ms: Date.now() - start,
            error: result?.message || 'Assertion failed',
          };
        }
      }

      case 'sleep': {
        const ms = step.duration || 1000;
        await new Promise(r => setTimeout(r, ms));
        return { action: step.action, duration_ms: Date.now() - start, status: 'success' };
      }

      default:
        return { action: step.action, status: 'skipped', duration_ms: Date.now() - start, error: `Unknown action: ${step.action}` };
    }
  } catch (err) {
    return {
      action: step.action,
      target: step.target,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function executeIOSStep(
  agent: IOSAgent,
  step: TestStep
): Promise<StepResult> {
  const start = Date.now();

  try {
    switch (step.action) {
      case 'launch': {
        const target = step.target || step.value || '';
        await agent.launch(target);
        return { action: step.action, target, status: 'success', duration_ms: Date.now() - start };
      }

      case 'tap': {
        await agent.aiTap(step.target || 'click target', {});
        return { action: step.action, target: step.target, status: 'success', duration_ms: Date.now() - start };
      }

      case 'input': {
        const text = step.value || '';
        await agent.aiInput(text, { value: text });
        return { action: step.action, target: step.target, value: text, status: 'success', duration_ms: Date.now() - start };
      }

      case 'swipe': {
        const direction = step.direction || 'up';
        const distance = step.duration || 300;
        if (direction === 'up') {
          await agent.aiScroll(undefined, { direction: 'up', distance });
        } else if (direction === 'down') {
          await agent.aiScroll(undefined, { direction: 'down', distance });
        } else if (direction === 'left') {
          await agent.aiScroll(undefined, { direction: 'left', distance });
        } else if (direction === 'right') {
          await agent.aiScroll(undefined, { direction: 'right', distance });
        }
        return { action: step.action, direction: step.direction, status: 'success', duration_ms: Date.now() - start };
      }

      case 'scroll': {
        const direction = step.direction || 'up';
        const distance = step.duration || 300;
        await agent.aiScroll(undefined, { direction, distance });
        return { action: step.action, direction: step.direction, status: 'success', duration_ms: Date.now() - start };
      }

      case 'home': {
        await agent.home();
        return { action: step.action, status: 'success', duration_ms: Date.now() - start };
      }

      case 'screenshot': {
        const result = await (agent as any).page.screenshot();
        return { action: step.action, status: 'success', duration_ms: Date.now() - start, screenshot: result.toString('base64') };
      }

      case 'assert': {
        const result = await agent.aiAssert(step.value || step.target || 'check condition');
        if (result?.pass) {
          return { action: step.action, target: step.target, status: 'success', duration_ms: Date.now() - start };
        } else {
          return {
            action: step.action,
            target: step.target,
            status: 'failed',
            duration_ms: Date.now() - start,
            error: result?.message || 'Assertion failed',
          };
        }
      }

      case 'sleep': {
        const ms = step.duration || 1000;
        await new Promise(r => setTimeout(r, ms));
        return { action: step.action, duration_ms: Date.now() - start, status: 'success' };
      }

      default:
        return { action: step.action, status: 'skipped', duration_ms: Date.now() - start, error: `Unknown action: ${step.action}` };
    }
  } catch (err) {
    return {
      action: step.action,
      target: step.target,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function runCaseContent(
  agent: AndroidAgent | IOSAgent,
  content: string,
  type: 'text' | 'yaml'
): Promise<StepResult> {
  const start = Date.now();
  const label = type === 'yaml' ? 'YAML 流程' : '用例内容';
  try {
    if (type === 'yaml') {
      await agent.runYaml(content);
    } else {
      await agent.aiAct(content);
    }
    return { action: label, status: 'success', duration_ms: Date.now() - start };
  } catch (err) {
    return {
      action: label,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function executeMobileTest(
  testCase: MobileTestCaseRow,
  _opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();

  // New path: case_content + case_content_type (text → aiAct, yaml → runYaml).
  // Legacy path: test_script 10-action JSON (10-action switch).
  const hasNew = !!(testCase.case_content && testCase.case_content.trim().length > 0);
  const legacyScript = !hasNew ? testCase.test_script : null;
  // Precondition: a single natural-language action handed to Midscene's
  // `aiAct` before the main case content runs. Old rows may still hold
  // a JSON NLStep[] from the legacy assertion-shaped format — the
  // helper flattens those into a single text so existing rows execute.
  const preconditionText = resolvePreconditionText(testCase.preconditions);

  if (!hasNew && (!legacyScript || legacyScript.trim().length === 0) && !preconditionText) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      screenshots: [],
      error_message: 'No case content defined',
    };
  }

  console.log(`[executor:mobile] case=${testCase.id} start name="${testCase.name}" platform=${testCase.platform || 'android'} hasNew=${hasNew} hasLegacy=${!!legacyScript} hasPrecondition=${!!preconditionText}`);

  // Push this user's Midscene model config (DB row → MIDSCENE_* env vars) so the
  // agent uses the user's chosen model / API key without restarting the server.
  if (_opts.userId) {
    try {
      await applyUserMidsceneConfig(_opts.userId, `case=${testCase.id} start`);
    } catch (e) {
      console.log(`[executor:mobile] case=${testCase.id} applyUserMidsceneConfig failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  let androidAgent: AndroidAgent | null = null;
  let iosAgent: IOSAgent | null = null;

  try {
    const platform = testCase.platform || 'android';

    if (platform === 'ios') {
      const envCheck = await checkIOSEnvironment();
      if (!envCheck.available) {
        return {
          status: 'error',
          duration_ms: Date.now() - globalStart,
          steps: [],
          screenshots: [],
          error_message: `iOS environment not available: ${envCheck.error}`,
        };
      }
      iosAgent = await agentFromWebDriverAgent({});
    } else {
      androidAgent = await agentFromAdbDevice(testCase.platform === 'android' ? (testCase as any).device_id : undefined);
    }
    console.log(`[executor:mobile] case=${testCase.id} agent ready platform=${platform}`);

    const agent = (platform === 'ios' ? iosAgent : androidAgent)!;

    // Precondition (optional): a single natural-language action that sets
    // up the desired state before the main case content runs.
    if (preconditionText) {
      const start = Date.now();
      console.log(`[executor:mobile] case=${testCase.id} precondition start text="${preconditionText.slice(0, 120)}"`);
      try {
        await agent.aiAct(preconditionText);
        const ms = Date.now() - start;
        console.log(`[executor:mobile] case=${testCase.id} precondition OK ${ms}ms`);
        results.push({
          action: `[前置] ${preconditionText}`,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:mobile] case=${testCase.id} precondition FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          action: `[前置] ${preconditionText}`,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: `Precondition failed: ${errorMsg}`,
        };
      }
    }

    if (hasNew) {
      // New path: hand the whole content to Midscene.
      const { content, type } = resolveCaseContent(
        testCase.case_content,
        testCase.case_content_type,
        null // legacy path not used when case_content is present
      );
      const preview = (content || '').slice(0, 120);
      console.log(`[executor:mobile] case=${testCase.id} content start type=${type} method=${type === 'yaml' ? 'runYaml' : 'aiAct'} preview="${preview}"`);
      const start = Date.now();
      const result = await runCaseContent(agent, content, type);
      const ms = Date.now() - start;
      if (result.status === 'success') {
        console.log(`[executor:mobile] case=${testCase.id} content OK ${ms}ms`);
      } else {
        console.log(`[executor:mobile] case=${testCase.id} content ${result.status.toUpperCase()} ${ms}ms err="${result.error}"`);
      }
      if (result.screenshot) screenshots.push(result.screenshot);
      results.push(result);
      if (result.status === 'failed') {
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: result.error,
        };
      }
    } else {
      // Legacy path: 10-action switch.
      let steps: TestStep[];
      try {
        steps = parseNLSteps(legacyScript).map(nlStepToMobileAction) as TestStep[];
      } catch {
        return {
          status: 'error',
          duration_ms: Date.now() - globalStart,
          steps: [],
          screenshots: [],
          error_message: 'Invalid test_script JSON',
        };
      }

      if (steps.length === 0) {
        return {
          status: 'error',
          duration_ms: Date.now() - globalStart,
          steps: [],
          screenshots: [],
          error_message: 'No test steps defined',
        };
      }

      for (const step of steps) {
        let result: StepResult;

        if (platform === 'ios' && iosAgent) {
          result = await executeIOSStep(iosAgent, step);
        } else if (androidAgent) {
          result = await executeAndroidStep(androidAgent, step);
        } else {
          result = { action: step.action, status: 'skipped', duration_ms: 0, error: 'No device available' };
        }

        if (result.screenshot) {
          screenshots.push(result.screenshot);
        }

        results.push(result);

        // Fail fast on failure
        if (result.status === 'failed' && step.action !== 'sleep' && step.action !== 'screenshot') {
          const remaining = steps.slice(results.length);
          for (const s of remaining) {
            results.push({ action: s.action, target: s.target, status: 'skipped', duration_ms: 0 });
          }
          break;
        }
      }
    }

    const hasFailure = results.some(r => r.status === 'failed');

    return {
      status: hasFailure ? 'failed' : 'success',
      duration_ms: Date.now() - globalStart,
      steps: results,
      screenshots,
      error_message: hasFailure ? results.find(r => r.status === 'failed')?.error : undefined,
    };
  } catch (err) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: results,
      screenshots,
      error_message: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    if (androidAgent) {
      await androidAgent.destroy().catch(() => {});
    }
    if (iosAgent) {
      await iosAgent.destroy().catch(() => {});
    }
  }
}
