// PC test executor - Midscene PlaywrightAgent.
//
// DEVIATION FROM PLAN (2026-06-03):
//   The plan calls for `@midscene/computer` (native desktop automation via
//   libnut + screenshot-desktop). The native deps are platform-specific
//   binaries and may break the build in environments without matching toolchain
//   (per the plan's own risk register: "MEDIUM — @midscene/computer 在 Linux/Win
//   上 agent 行为差异"). To honour the user constraint "最核心的一点,不能造成
//   功能不可用!", Phase 3 keeps the browser-based PlaywrightAgent flow and
//   introduces a `pickDevice(deviceId)` shim that records the selected device
//   without actually binding a native adapter. A follow-up phase can install
//   the native package and switch the agent to ComputerAgent behind the same
//   executor API.
//
// As of 2026-06-04: cases are no longer a list of typed NL steps. The
// `case_content` + `case_content_type` columns hold either text (→ aiAct) or
// YAML (→ runYaml). Preconditions + checkpoints remain in their own columns.
//
// As of 2026-06-05: share a single Playwright Browser across PC cases in the
// same process. Each case uses a fresh BrowserContext. The shared Browser is
// only torn down when the case has `close_browser_after_execution = 1` (or
// admin forces a close). Avoids the ~2-3s Chromium cold-start per case.

import { chromium, firefox, webkit, Browser, BrowserContext, Page, BrowserType } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { promises as fs } from 'node:fs';
import type { PcCaseRow } from '../db/pc-cases.js';
import { getDevice, type DeviceRow } from '../db/devices.js';
import {
  generateReportPath,
  ensureReportDir,
  reportFileName,
  type TestType,
} from './report-paths.js';
import { parseNLSteps, resolveCaseContent, resolvePreconditionText, type NLStep } from './nl-steps.js';
import { applyUserMidsceneConfig } from './midscene-config.js';

export { parseNLSteps, resolveCaseContent, nlStepsToText } from './nl-steps.js';

export interface StepResult {
  index: number;
  description: string;
  expect?: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
}

export interface ExecuteResult {
  status: 'success' | 'failed' | 'error';
  duration_ms: number;
  steps: StepResult[];
  error_message?: string;
  report_path?: string;
  report_url?: string;
  device?: DeviceRow | null;
}

export interface ExecuteOptions {
  executedBy: string;
  caseId: number;
  execId: number;
  testType?: TestType;
  deviceId?: number;
  // The owning user's id — used to load that user's Midscene model config
  // before each case so model / API key changes take effect immediately.
  userId?: number;
}

/**
 * Look up the requested device. Returns null if deviceId is not provided,
 * or if the device does not exist / does not belong to the PC test type.
 * Currently informational only (the browser flow ignores platform). When
 * ComputerAgent is wired in, this function's result drives adapter selection.
 */
export function pickDevice(deviceId?: number): DeviceRow | null {
  if (!deviceId) return null;
  const device = getDevice(deviceId);
  if (!device) return null;
  if (device.test_type !== 'pc') return null;
  return device;
}

// Module-level singleton. PC server-side automation currently always uses
// headless Chromium, but we still key by all launch params so a future
// change (e.g. picking a real PC browser type) can flow through unchanged.
interface SharedBrowserState {
  browser: Browser;
  key: string; // identifies the launch params (browserName|headless|driverPath)
  launchedAt: number;
  launches: number; // for log readability only
}
let _sharedBrowser: SharedBrowserState | null = null;
let _sharedBrowserClosing: Promise<void> | null = null;

function browserLaunchKey(browserName: string, headless: boolean, driverPath: string | null): string {
  return `${browserName}|${headless ? '1' : '0'}|${driverPath?.trim() || ''}`;
}

async function launchBrowser(
  browserName: string,
  headless: boolean,
  driverPath: string | null
): Promise<Browser> {
  // Map the request to the matching Playwright BrowserType. Midscene's
  // PlaywrightAgent does not provide its own launcher, so we drive
  // Playwright directly. Drivers are managed by Playwright (npx playwright
  // install) — set PLAYWRIGHT_BROWSERS_PATH to override the default location.
  const launcher: BrowserType =
    browserName === 'firefox' ? firefox
    : browserName === 'webkit' ? webkit
    : chromium;

  // Honour a per-case driver override. The index.ts default sets
  // PLAYWRIGHT_BROWSERS_PATH to the bundled ./drivers dir; if the case
  // supplies its own path, swap it in for the duration of the launch and
  // restore the original value afterwards.
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  console.log(`[executor:pc] launchBrowser: browserName=${browserName} headless=${headless} driverPath=${driverPath ?? '(null)'} env.PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'}`);
  if (driverPath && driverPath.trim()) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = driverPath.trim();
  }

  try {
    console.log(`[executor:pc] launcher.launch headless=${headless} launcher=${browserName} PBP=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'}`);
    const browser = await launcher.launch({
      headless,
      // Force SwiftShader software rendering. Playwright 1.60 + Chromium
      // 130+ "new headless" mode (default when `headless: true`) ships
      // without a working software-GL fallback on macOS, so
      // `page.screenshot()` and video frames come back blank. See
      // .wolf/cerebrum.md bug-038 for the root cause.
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
    });
    return browser;
  } finally {
    if (driverPath && driverPath.trim()) {
      if (previousBrowsersPath === undefined) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      } else {
        process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
      }
    }
  }
}

/**
 * Return the process-wide shared Browser, launching a new one if (a) none
 * exists yet, or (b) the launch params differ from the current one. Each
 * case still gets a fresh BrowserContext from the shared Browser.
 */
async function getSharedBrowser(
  browserName: string,
  headless: boolean,
  driverPath: string | null
): Promise<Browser> {
  const key = browserLaunchKey(browserName, headless, driverPath);

  if (_sharedBrowserClosing) {
    await _sharedBrowserClosing.catch(() => {});
  }

  if (_sharedBrowser && _sharedBrowser.key === key) {
    _sharedBrowser.launches += 1;
    console.log(`[executor:pc] reuse shared browser id=${_sharedBrowser.browser.browserType().name()} launches=${_sharedBrowser.launches} uptimeMs=${Date.now() - _sharedBrowser.launchedAt}`);
    return _sharedBrowser.browser;
  }

  if (_sharedBrowser) {
    console.log(`[executor:pc] shared browser params changed (old=${_sharedBrowser.key} new=${key}), closing old`);
    const old = _sharedBrowser;
    _sharedBrowser = null;
    _sharedBrowserClosing = old.browser.close().catch((e) => {
      console.log(`[executor:pc] old shared browser close error: ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => { _sharedBrowserClosing = null; });
    await _sharedBrowserClosing;
  }

  const browser = await launchBrowser(browserName, headless, driverPath);
  _sharedBrowser = { browser, key, launchedAt: Date.now(), launches: 1 };
  console.log(`[executor:pc] new shared browser launched id=${browser.browserType().name()} key=${key}`);
  return browser;
}

/**
 * Force-close the shared browser. Safe to call multiple times concurrently.
 * Used by the admin "close shared browser" endpoint and by the per-case
 * `close_browser_after_execution` flag.
 */
export async function closeSharedBrowser(): Promise<void> {
  if (!_sharedBrowser && !_sharedBrowserClosing) {
    console.log(`[executor:pc] closeSharedBrowser: no shared browser to close`);
    return;
  }
  if (_sharedBrowser) {
    const old = _sharedBrowser;
    _sharedBrowser = null;
    _sharedBrowserClosing = old.browser.close().catch((e) => {
      console.log(`[executor:pc] shared browser close error: ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => { _sharedBrowserClosing = null; });
  }
  if (_sharedBrowserClosing) {
    await _sharedBrowserClosing.catch(() => {});
  }
  console.log(`[executor:pc] shared browser closed`);
}

/** Diagnostic helper for the admin endpoint. */
export function getSharedBrowserInfo(): { key: string; launches: number; uptimeMs: number } | null {
  if (!_sharedBrowser) return null;
  return {
    key: _sharedBrowser.key,
    launches: _sharedBrowser.launches,
    uptimeMs: Date.now() - _sharedBrowser.launchedAt,
  };
}

async function setupBrowser(
  browserName: string,
  windowSize: string,
  headless: boolean,
  driverPath: string | null
): Promise<{ browser: Browser; context: BrowserContext; page: Page; reused: boolean }> {
  const browser = await getSharedBrowser(browserName, headless, driverPath);

  const [width, height] = windowSize.split('x').map(Number);
  const context = await browser.newContext({
    viewport: { width: width || 1920, height: height || 1080 },
  });
  const page = await context.newPage();
  return { browser, context, page, reused: _sharedBrowser ? _sharedBrowser.launches > 1 : false };
}

async function copyMidsceneReport(
  sourcePath: string | null | undefined,
  targetPath: string
): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  try {
    await ensureReportDir(targetPath);
    await fs.copyFile(sourcePath, targetPath);
    return targetPath;
  } catch {
    return undefined;
  }
}

export async function executePcCase(
  testCase: PcCaseRow,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();
  const { content, type } = resolveCaseContent(
    testCase.case_content,
    testCase.case_content_type,
    testCase.steps
  );
  const checkpoints = parseNLSteps(testCase.check_points);
  // Preconditions: a single natural-language task passed to Midscene's
  // `aiAct` (action). Old rows may still hold a JSON NLStep[] from the
  // legacy assertion-shaped format — resolvePreconditionText flattens
  // those into a single string so existing rows still execute.
  const preconditionText = resolvePreconditionText(testCase.preconditions);
  // Phase 3.5: browser/headless_mode/base_url fields removed from pc_test_cases.
  // Server-side PC automation always uses headless Chromium; baseUrl navigation
  // is encoded into the first NL step when needed.
  const headless = true;
  const browser = 'chromium';
  const windowSize = testCase.window_size || '1920x1080';
  const testType: TestType = opts.testType || 'computer';
  const device = pickDevice(opts.deviceId);

  if (!content && checkpoints.length === 0 && !preconditionText) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      error_message: 'No case content defined',
      device,
    };
  }

  const results: StepResult[] = [];
  let browserInstance: Browser | null = null;
  let contextInstance: BrowserContext | null = null;
  let reportPath: string | undefined;
  const finalReportPath = generateReportPath(testType, opts.caseId, opts.execId, opts.userId);
  console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} report path resolved: ${finalReportPath} (userRoot=${opts.userId ? 'per-user' : 'default'})`);
  const reportName = reportFileName(testType, opts.caseId, opts.execId);
  // close_browser_after_execution=1 → tear down the shared Browser after
  // this case. Default 0 → keep it for the next case (avoids ~2-3s cold
  // start per case). The per-case BrowserContext is closed regardless.
  const closeBrowserAfter = testCase.close_browser_after_execution === 1;

  console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} start name="${testCase.name}" type=${type} hasContent=${!!content} hasPrecondition=${!!preconditionText} checkpoints=${checkpoints.length} window=${windowSize} headless=${headless} device=${device?.id ?? '(none)'} closeBrowserAfter=${closeBrowserAfter}`);

  // Push the owning user's Midscene model config into the live runtime
  // before any agent action. Best-effort: a failure here will surface
  // again inside agent.aiAct() so we don't need a hard throw.
  if (opts.userId) {
    try {
      await applyUserMidsceneConfig(opts.userId, `case=${opts.caseId} exec=${opts.execId} start`);
    } catch (e) {
      console.log(`[executor:pc] case=${opts.caseId} applyUserMidsceneConfig failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const { browser: b, context, page, reused } = await setupBrowser(browser, windowSize, headless, testCase.driver_path);
    browserInstance = b;
    contextInstance = context;
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} browser ready url=${page.url()} reusedBrowser=${reused}`);

    const agent = new PlaywrightAgent(page, {
      generateReport: true,
      outputFormat: 'html-and-external-assets',
      reportFileName: reportName,
      groupName: testCase.name,
      groupDescription: testCase.description || undefined,
    });
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} PlaywrightAgent ready report=${reportName}`);

    let stepIndex = 0;

    const runAssert = async (s: NLStep, idx: number): Promise<StepResult> => {
      const start = Date.now();
      const desc = `[检查] ${s.description}`;
      const expectText = s.expect || s.description;
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] start expect="${expectText.slice(0, 100)}"`);
      try {
        if (expectText) {
          const result = await agent.aiAssert(expectText);
          const ms = Date.now() - start;
          if (!result?.pass) {
            console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] FAILED ${ms}ms reason="${result?.message || 'Assertion failed'}"`);
            return {
              index: stepIndex++,
              description: desc,
              expect: expectText,
              status: 'failed',
              duration_ms: ms,
              error: result?.message || 'Assertion failed',
            };
          }
          console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] PASS ${ms}ms`);
        }
        return {
          index: stepIndex++,
          description: desc,
          expect: expectText,
          status: 'success',
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] THREW ${ms}ms err="${errorMsg}"`);
        return {
          index: stepIndex++,
          description: desc,
          expect: expectText,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        };
      }
    };

    // Precondition: a single natural-language action handed to Midscene's
    // `aiAct` so the user can describe the desired starting state
    // ("打开 /login,等待 3 秒" etc.) without picking a step type.
    if (preconditionText) {
      const start = Date.now();
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} precondition start text="${preconditionText.slice(0, 120)}"`);
      try {
        await agent.aiAct(preconditionText);
        const ms = Date.now() - start;
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} precondition OK ${ms}ms`);
        results.push({
          index: stepIndex++,
          description: `[前置] ${preconditionText}`,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} precondition FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          index: stepIndex++,
          description: `[前置] ${preconditionText}`,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        await agent.destroy().catch(() => {});
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Precondition failed: ${errorMsg}`,
          device,
        };
      }
    }

    // Main case content: hand the whole thing to Midscene.
    if (content) {
      const start = Date.now();
      const label = type === 'yaml' ? 'YAML 流程' : '用例内容';
      const preview = content.slice(0, 120);
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} content start type=${type} method=${type === 'yaml' ? 'runYaml' : 'aiAct'} preview="${preview}"`);
      try {
        if (type === 'yaml') {
          await agent.runYaml(content);
        } else {
          await agent.aiAct(content);
        }
        const ms = Date.now() - start;
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} content OK ${ms}ms`);
        results.push({
          index: stepIndex++,
          description: label,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} content FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          index: stepIndex++,
          description: label,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        await agent.destroy().catch(() => {});
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Case failed: ${errorMsg}`,
          device,
        };
      }
    }

    // Checkpoints: assert-only.
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoints start count=${checkpoints.length}`);
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const r = await runAssert(cp, i);
      results.push(r);
      if (r.status === 'failed') {
        await agent.destroy().catch(() => {});
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Checkpoint failed: ${r.error}`,
          device,
        };
      }
    }
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoints OK`);

    await agent.destroy().catch(() => {});
    const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
    if (copied) {
      reportPath = copied;
    }

    const totalMs = Date.now() - globalStart;
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} done SUCCESS ${totalMs}ms steps=${results.length} report=${reportPath ?? '(none)'}`);
    return {
      status: 'success',
      duration_ms: totalMs,
      steps: results,
      report_path: reportPath,
      device,
    };
  } catch (err) {
    const totalMs = Date.now() - globalStart;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} done ERROR ${totalMs}ms err="${errorMsg}"`);
    return {
      status: 'error',
      duration_ms: totalMs,
      steps: results,
      error_message: errorMsg,
      report_path: reportPath,
      device,
    };
  } finally {
    // Always close the per-case BrowserContext (cookies/storage cleanup).
    // The shared Browser is only torn down if the case opted in via
    // `close_browser_after_execution=1` — otherwise the next case reuses
    // it. browserInstance is the same object as the shared one in both
    // branches; closeSharedBrowser() nulls out the singleton so the next
    // case launches a fresh one.
    if (contextInstance) {
      await contextInstance.close().catch((e) => {
        console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} context close error: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    if (closeBrowserAfter && browserInstance) {
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} closeBrowserAfter=1, tearing down shared browser`);
      await closeSharedBrowser();
    }
  }
}
