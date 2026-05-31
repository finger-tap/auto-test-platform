// Web test executor - browser automation via Playwright + Midscene AI
// Supports: Chrome, Firefox, Safari, Edge on Windows/macOS/Linux

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import type { WebCaseRow } from '../db/web-cases.js';

export interface StepResult {
  action: string;
  desc?: string;
  value?: string;
  direction?: string;
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

export interface TestStep {
  action: string;
  desc: string;
}

function parseSteps(stepsJson: string | null): TestStep[] {
  if (!stepsJson) return [];
  try {
    return JSON.parse(stepsJson);
  } catch {
    return [];
  }
}

function parseCheckPoints(cpJson: string | null): TestStep[] {
  if (!cpJson) return [];
  try {
    return JSON.parse(cpJson);
  } catch {
    return [];
  }
}

function parsePreconditions(preJson: string | null): TestStep[] {
  if (!preJson) return [];
  try {
    return JSON.parse(preJson);
  } catch {
    return [];
  }
}

async function setupBrowser(
  browserName: string,
  windowSize: string,
  headless: boolean
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browserType = browserName === 'firefox' ? 'firefox' :
    browserName === 'webkit' ? 'webkit' : 'chromium';

  const browser = await chromium.launch({
    headless,
    channel: browserType === 'chromium' ? 'chromium' : undefined,
  });

  const [width, height] = windowSize.split('x').map(Number);
  const context = await browser.newContext({
    viewport: { width: width || 1920, height: height || 1080 },
  });
  const page = await context.newPage();

  return { browser, context, page };
}

async function executeStepWithMidscene(
  agent: PlaywrightAgent,
  step: TestStep
): Promise<StepResult> {
  const start = Date.now();

  try {
    switch (step.action) {
      case '打开页面':
      case '导航': {
        await (agent as any).page.goto(step.desc, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await (agent as any).page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
      }

      case '输入': {
        await agent.aiInput(step.desc, { value: step.desc });
        return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
      }

      case '点击': {
        await agent.aiTap(step.desc, {});
        return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
      }

      case '勾选': {
        const checkboxDesc = step.desc.includes('勾选') ? step.desc : `勾选 ${step.desc}`;
        await agent.aiTap(checkboxDesc, {});
        return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
      }

      case '滚动': {
        const scrollAmount = parseInt(step.desc, 10) || 300;
        await agent.aiScroll(undefined, { distance: scrollAmount, direction: 'down' });
        return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
      }

      case '等待': {
        const ms = parseInt(step.desc, 10) || 1000;
        await new Promise(r => setTimeout(r, ms));
        return { action: step.action, desc: `${ms}ms`, status: 'success', duration_ms: Date.now() - start };
      }

      case '断言': {
        const result = await agent.aiAssert(step.desc);
        if (result?.pass) {
          return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
        } else {
          return {
            action: step.action,
            desc: step.desc,
            status: 'failed',
            duration_ms: Date.now() - start,
            error: result?.message || 'Assertion failed',
          };
        }
      }

      case '检查页面跳转':
      case '检查文本':
      case '检查元素': {
        const result = await agent.aiAssert(step.desc);
        if (result?.pass) {
          return { action: step.action, desc: step.desc, status: 'success', duration_ms: Date.now() - start };
        } else {
          return {
            action: step.action,
            desc: step.desc,
            status: 'failed',
            duration_ms: Date.now() - start,
            error: result?.message || 'Check failed',
          };
        }
      }

      default:
        return {
          action: step.action,
          desc: step.desc,
          status: 'skipped',
          duration_ms: Date.now() - start,
          error: `Unknown action: ${step.action}`,
        };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    // Capture screenshot on failure
    let screenshot: string | undefined;
    try {
      const buf = await (agent as any).page.screenshot({ timeout: 5000 });
      screenshot = buf.toString('base64');
    } catch { /* ignore */ }
    return {
      action: step.action,
      desc: step.desc,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: errorMsg,
      screenshot,
    };
  }
}

export async function executeWebCase(
  testCase: WebCaseRow,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();
  const steps = parseSteps(testCase.steps);
  const checkpoints = parseCheckPoints(testCase.check_points);
  const preconditions = parsePreconditions(testCase.preconditions);
  const headless = testCase.headless_mode === 1;
  const browser = testCase.browser || 'chromium';
  const windowSize = testCase.window_size || '1920x1080';
  const baseUrl = testCase.base_url || '';

  if (steps.length === 0 && checkpoints.length === 0 && preconditions.length === 0) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      screenshots: [],
      error_message: 'No steps or checkpoints defined',
    };
  }

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  let browserInstance: Browser | null = null;

  try {
    const { browser: b, page } = await setupBrowser(browser, windowSize, headless);
    browserInstance = b;

    const agent = new PlaywrightAgent(page);

    // Execute preconditions first
    for (const precond of preconditions) {
      const result = await executeStepWithMidscene(agent, precond);
      results.push({ ...result, action: `[前置] ${result.action}` });
      if (result.status === 'failed') {
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: `Precondition failed: ${result.error}`,
        };
      }
    }

    // Navigate to base URL first if configured
    if (baseUrl) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    // Execute main steps
    for (const step of steps) {
      // Substitute variables in step desc if needed
      let desc = step.desc;
      const result = await executeStepWithMidscene(agent, { action: step.action, desc });
      results.push(result);
      if (result.screenshot) screenshots.push(result.screenshot);
      if (result.status === 'failed') {
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: `Step failed: ${result.error}`,
        };
      }
    }

    // Execute checkpoints
    for (const cp of checkpoints) {
      const result = await executeStepWithMidscene(agent, cp);
      results.push({ ...result, action: `[检查] ${result.action}` });
      if (result.screenshot) screenshots.push(result.screenshot);
      if (result.status === 'failed') {
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: `Checkpoint failed: ${result.error}`,
        };
      }
    }

    // Capture final screenshot
    try {
      const buf = await page.screenshot();
      screenshots.push(buf.toString('base64'));
    } catch { /* ignore */ }

    return {
      status: 'success',
      duration_ms: Date.now() - globalStart,
      steps: results,
      screenshots,
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
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
    }
  }
}