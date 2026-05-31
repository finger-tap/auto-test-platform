// Mobile test executor - Android/iOS automation via Midscene
// Reference: @midscene/android, @midscene/ios

import { agentFromAdbDevice, AndroidAgent } from '@midscene/android';
import { agentFromWebDriverAgent, IOSAgent, checkIOSEnvironment } from '@midscene/ios';
import type { MobileTestCaseRow } from '../db/mobile-tests.js';

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
}

export interface ExecuteOptions {
  executedBy: string;
  environmentId?: number;
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

export async function executeMobileTest(
  testCase: MobileTestCaseRow,
  _opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();
  let steps: TestStep[];

  try {
    steps = JSON.parse(testCase.test_script || '[]');
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

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  let androidAgent: AndroidAgent | null = null;
  let iosAgent: IOSAgent | null = null;

  try {
    const platform = testCase.platform || 'android';

    if (platform === 'ios') {
      // Check iOS environment availability
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
      iosAgent = await agentFromWebDriverAgent({
        // modelConfig will be read from environment variables
      });
    } else {
      // Android
      androidAgent = await agentFromAdbDevice(testCase.platform === 'android' ? (testCase as any).device_id : undefined);
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
    // Cleanup agents
    if (androidAgent) {
      await androidAgent.destroy().catch(() => {});
    }
    if (iosAgent) {
      await iosAgent.destroy().catch(() => {});
    }
  }
}