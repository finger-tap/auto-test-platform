// PC test executor — Midscene ComputerAgent (native desktop automation).
//
// 2026-06-14: Replaced the PlaywrightAgent (headless browser) flow with
// @midscene/computer's ComputerAgent. ComputerAgent drives the real desktop
// via libnut (native keyboard/mouse) + screenshot-desktop, so it can test
// ANY desktop application — not just web pages. This matches Midscene's
// `agentForComputer()` API.
//
// The execution model (precondition → case content → checkpoints → report)
// is unchanged from the Playwright era — ComputerAgent inherits the same
// aiAct / aiAssert / runYaml API from @midscene/core's Agent base class,
// so the surrounding orchestration is identical.
//
// 2026-06-15: Remote execution (device.test_type==='pc' && agent_endpoint)
// routes to a pc-agent service over HTTP. The agent runs the whole case
// locally with @midscene/computer, then the server fetches the report tar.gz.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ComputerAgent,
  agentForComputer,
  checkComputerEnvironment,
  checkScreenRecordingPermission,
  checkAccessibilityPermission,
} from '@midscene/computer';
import type { PcCaseRow } from '../db/pc-cases.js';
import { getDevice, type DeviceRow } from '../db/devices.js';
import {
  generateReportPath,
  ensureReportDir,
  reportFileName,
  type TestType,
} from './report-paths.js';
import { parseNLSteps, resolveCaseContent, resolvePreconditionText, nlStepsToText, type NLStep } from './nl-steps.js';
import { applyUserMidsceneConfig, getAgentOptOverrides } from './midscene-config.js';
import {
  executeOnPcAgent,
  downloadPcReport,
  type PcAgentExecuteRequest,
} from './agent-client.js';
import { substituteVars } from './vars.js';

export { parseNLSteps, resolveCaseContent, nlStepsToText } from './nl-steps.js';

/** Wrap a promise with a wall-clock timeout. Rejects if the promise doesn't settle in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    }),
  ]);
}

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
  /** Environment variables for ${varName} substitution in content/preconditions/checkpoints. */
  envVars?: Record<string, string>;
}

/**
 * Look up the requested device. Returns null if deviceId is not provided,
 * or if the device does not exist / does not belong to the PC test type.
 * A null result means "run locally on this server's desktop".
 * A non-null result with agent_endpoint means "run on a remote pc-agent"
 * (Phase 2 — currently throws a not-implemented error).
 */
export function pickDevice(deviceId?: number): DeviceRow | null {
  if (!deviceId) return null;
  const device = getDevice(deviceId);
  if (!device) return null;
  if (device.test_type !== 'pc') return null;
  return device;
}

async function copyMidsceneReport(
  sourcePath: string | null | undefined,
  targetPath: string
): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  try {
    // sourcePath is the index.html inside the report directory.
    // With html-and-external-assets format, the companion screenshots/
    // directory lives in the same parent. Copy the whole tree so the
    // report can resolve relative refs like ./screenshots/<uuid>.png.
    const sourceDir = path.dirname(sourcePath);
    const targetDir = path.dirname(targetPath);
    await ensureReportDir(targetPath);
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    return targetPath;
  } catch (e) {
    console.log(`[executor:pc] copyMidsceneReport failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * Build ComputerDeviceOpt overrides from the case row. Only non-null fields
 * are passed; ComputerAgent falls back to its defaults for the rest.
 */
function buildComputerDeviceOpt(testCase: PcCaseRow) {
  const opt: {
    displayId?: string;
    keyboardDriver?: 'applescript' | 'libnut';
    headless?: boolean;
    xvfbResolution?: string;
  } = {};
  if (testCase.display_id && testCase.display_id.trim()) {
    opt.displayId = testCase.display_id.trim();
  }
  if (testCase.keyboard_driver === 'applescript' || testCase.keyboard_driver === 'libnut') {
    opt.keyboardDriver = testCase.keyboard_driver;
  }
  if (testCase.headless === 1) {
    opt.headless = true;
  }
  if (testCase.xvfb_resolution && testCase.xvfb_resolution.trim()) {
    opt.xvfbResolution = testCase.xvfb_resolution.trim();
  }
  return opt;
}

/**
 * Remote execution: POST the whole case to pc-agent, wait for result,
 * then download the report tarball and extract it to the standard path.
 */
async function executePcCaseRemotely(
  testCase: PcCaseRow,
  opts: ExecuteOptions,
  device: DeviceRow,
  content: string,
  contentType: 'text' | 'yaml',
  checkpoints: NLStep[],
  preconditionText: string | undefined,
  testType: TestType,
  globalStart: number,
): Promise<ExecuteResult> {
  const agentEndpoint = device.agent_endpoint!;
  const agentToken = device.agent_token!;
  const finalReportPath = generateReportPath(testType, opts.caseId, opts.execId, opts.userId);
  const reportName = reportFileName(testType, opts.caseId, opts.execId);
  const deviceOpt = buildComputerDeviceOpt(testCase);

  // Map NLStep[] → plain objects for JSON serialization
  const checkpointPayload = checkpoints.map(cp => ({
    description: cp.description,
    expect: cp.expect || undefined,
  }));

  const request: PcAgentExecuteRequest = {
    groupName: testCase.name,
    groupDescription: testCase.description || undefined,
    reportName,
    content,
    contentType,
    preconditionText: preconditionText || undefined,
    checkpoints: checkpointPayload,
    deviceOpt: deviceOpt as Record<string, unknown>,
  };

  console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} REMOTE agent=${agentEndpoint} name="${testCase.name}" checkpoints=${checkpoints.length}`);

  try {
    // Push Midscene config before executing remotely. Note: the agent uses
    // its own Midscene config from env vars / default. If we want per-user
    // config propagation to agents, that's a future enhancement.
    // For now, we just send the case and let the agent use its local config.
    const agentResult = await executeOnPcAgent(agentEndpoint, agentToken, request);
    const totalMs = Date.now() - globalStart;

    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} REMOTE done sessionId=${agentResult.sessionId} status=${agentResult.result.status} duration=${agentResult.result.duration_ms}ms`);

    // Download and extract report tarball
    let reportPath: string | undefined;
    if (agentResult.sessionId) {
      try {
        const tarball = await downloadPcReport(agentEndpoint, agentToken, agentResult.sessionId);
        // Extract the tarball to a temp dir, then copy the HTML report
        const tmpExtractDir = path.join(tmpdir(), `pc-report-${opts.caseId}-${opts.execId}`);
        await fs.mkdir(tmpExtractDir, { recursive: true });
        // Write tarball to temp file, then use tar to extract
        const tmpTarPath = path.join(tmpdir(), `pc-report-${opts.caseId}-${opts.execId}.tar.gz`);
        await fs.writeFile(tmpTarPath, tarball);
        const { execFile } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          execFile('tar', ['xzf', tmpTarPath, '-C', tmpExtractDir], (err) => {
            err ? reject(err) : resolve();
          });
        });
        // Cleanup tarball temp file
        await fs.unlink(tmpTarPath).catch(() => {});
        // Find the HTML report in the extracted dir (recursively)
        const htmlFiles = await findFilesRecursive(tmpExtractDir, '.html');
        if (htmlFiles.length > 0) {
          // Copy the entire report dir to the final path
          await ensureReportDir(finalReportPath);
          // The report dir is the parent of the HTML file
          const reportDir = path.dirname(htmlFiles[0]);
          await copyDirRecursive(reportDir, path.dirname(finalReportPath));
          reportPath = finalReportPath;
        } else {
          console.log(`[executor:pc] case=${opts.caseId} REMOTE no HTML report found in tarball`);
        }
        // Cleanup temp dir
        await fs.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[executor:pc] case=${opts.caseId} REMOTE report download/extract failed: ${msg}`);
      }
    }

    // Map agent result steps to local StepResult format
    const steps: StepResult[] = (agentResult.result.steps || []).map((s, i) => ({
      index: i,
      description: s.description,
      expect: s.expect,
      status: s.status,
      duration_ms: s.duration_ms,
      error: s.error,
    }));

    return {
      status: agentResult.result.status === 'success' ? 'success'
        : agentResult.result.status === 'failed' ? 'failed'
        : 'error',
      duration_ms: totalMs,
      steps,
      error_message: agentResult.result.error_message,
      report_path: reportPath,
      device,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const totalMs = Date.now() - globalStart;
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} REMOTE ERROR ${totalMs}ms: ${msg}`);
    return {
      status: 'error',
      duration_ms: totalMs,
      steps: [],
      error_message: `Remote pc-agent execution failed: ${msg}`,
      device,
    };
  }
}

/**
 * Recursively find files with a given extension in a directory.
 */
async function findFilesRecursive(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...await findFilesRecursive(full, ext));
      } else if (e.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}

/**
 * Recursively copy a directory's contents to a target directory.
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (e.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function executePcCase(
  testCase: PcCaseRow,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();
  const { content: rawContent, type } = resolveCaseContent(
    testCase.case_content,
    testCase.case_content_type,
    testCase.steps
  );
  const rawCheckpoints = parseNLSteps(testCase.check_points);
  const rawPreconditionText = resolvePreconditionText(testCase.preconditions);
  const testType: TestType = opts.testType || 'computer';

  // Substitute ${varName} placeholders with environment variable values
  const vars = opts.envVars || {};
  const content = substituteVars(rawContent, vars);
  const preconditionText = substituteVars(rawPreconditionText, vars);
  const checkpoints = rawCheckpoints.map(cp => ({
    ...cp,
    description: substituteVars(cp.description, vars),
    ...(cp.expect ? { expect: substituteVars(cp.expect, vars) } : {}),
  }));
  const device = pickDevice(opts.deviceId);
  if (Object.keys(vars).length > 0) {
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} envVars=${Object.keys(vars).length} keys=${Object.keys(vars).join(',')}`);
  }

  if (!content && checkpoints.length === 0 && !preconditionText) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      error_message: 'No case content defined',
      device,
    };
  }

  // ── Remote execution via pc-agent ──
  // The agent runs the whole case locally (ComputerDevice is bound to physical
  // hardware and can't be serialized). We send the case content, wait for the
  // result, then fetch the report tarball.
  if (device && device.status !== 'online') {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      error_message: `设备 ${device.name} 当前状态为 ${device.status}，无法远程执行（需要 agent 在线）`,
      device,
    };
  }
  if (device && device.agent_endpoint && device.agent_token) {
    return executePcCaseRemotely(testCase, opts, device, content, type, checkpoints, preconditionText, testType, globalStart);
  }

  const results: StepResult[] = [];
  let reportPath: string | undefined;
  const finalReportPath = generateReportPath(testType, opts.caseId, opts.execId, opts.userId);
  console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} report path resolved: ${finalReportPath} (userRoot=${opts.userId ? 'per-user' : 'default'})`);
  const reportName = reportFileName(testType, opts.caseId, opts.execId);

  console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} start name="${testCase.name}" type=${type} hasContent=${!!content} hasPrecondition=${!!preconditionText} checkpoints=${checkpoints.length} device=${device?.id ?? '(local)'} displayId=${testCase.display_id ?? '(main)'} keyboardDriver=${testCase.keyboard_driver ?? '(default)'} headless=${testCase.headless ?? 0}`);

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

  let agent: ComputerAgent | null = null;
  try {
    // Environment pre-check: HARD FAIL if critical permissions are missing.
    // Without Screen Recording permission, screenshots are black → reports
    // are useless. Without Accessibility, keyboard/mouse input won't work.
    const envCheck = await checkComputerEnvironment();
    if (!envCheck.available) {
      return {
        status: 'error',
        duration_ms: Date.now() - globalStart,
        steps: [],
        error_message: `Computer environment check failed: ${envCheck.error || 'unknown'} (platform=${envCheck.platform} displays=${envCheck.displays})`,
        device,
      };
    }
    console.log(`[executor:pc] case=${opts.caseId} env OK platform=${envCheck.platform} displays=${envCheck.displays}`);

    // macOS: explicitly check Screen Recording + Accessibility permissions.
    // These are independent TCC permissions — granting one doesn't grant the other.
    if (process.platform === 'darwin') {
      const screenPerm = checkScreenRecordingPermission(false);
      if (!screenPerm.hasPermission) {
        return {
          status: 'error',
          duration_ms: Date.now() - globalStart,
          steps: [],
          error_message: `Screen Recording permission required — screenshots will be black without it.\n\n${screenPerm.error}`,
          device,
        };
      }
      const accessPerm = checkAccessibilityPermission(false);
      if (!accessPerm.hasPermission) {
        return {
          status: 'error',
          duration_ms: Date.now() - globalStart,
          steps: [],
          error_message: `Accessibility permission required — keyboard/mouse input won't work without it.\n\n${accessPerm.error}`,
          device,
        };
      }
      console.log(`[executor:pc] case=${opts.caseId} macOS permissions OK (Screen Recording + Accessibility)`);
    }

    const deviceOpt = buildComputerDeviceOpt(testCase);
    const agentInitStart = Date.now();
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} agentForComputer starting...`);
    try {
      agent = await withTimeout(
        agentForComputer({
          ...deviceOpt,
          generateReport: true,
          outputFormat: 'html-and-external-assets',
          reportFileName: reportName,
          groupName: testCase.name,
          groupDescription: testCase.description || undefined,
          ...getAgentOptOverrides(opts.userId),
        }),
        60_000,
        'agentForComputer init',
      );
    } catch (initErr) {
      const ms = Date.now() - agentInitStart;
      const msg = initErr instanceof Error ? initErr.message : String(initErr);
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} agentForComputer FAILED ${ms}ms: ${msg}`);
      return {
        status: 'error',
        duration_ms: Date.now() - globalStart,
        steps: [],
        error_message: `ComputerAgent 初始化失败: ${msg}`,
        device,
      };
    }
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} ComputerAgent ready ${Date.now() - agentInitStart}ms report=${reportName}`);

    let stepIndex = 0;

    // Use the case's timeout setting (default 5 min) to prevent infinite hangs.
    const caseTimeoutMs = (testCase.timeout && testCase.timeout > 0) ? testCase.timeout : 300_000;

    const runAssert = async (s: NLStep, idx: number): Promise<StepResult> => {
      const start = Date.now();
      const desc = `[检查] ${s.description}`;
      const expectText = s.expect || s.description;
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] start expect="${expectText.slice(0, 100)}"`);
      try {
        if (expectText) {
          const result = await withTimeout(agent!.aiAssert(expectText), caseTimeoutMs, `checkpoint[${idx}]`);
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

    // Helper: destroy agent + copy its report to the target path. Returns
    // the copied path (or undefined). Must be called before nulling `agent`.
    // We capture reportFile BEFORE destroy() because destroy() finalizes
    // the report path and we don't want a use-after-free on agent.reportFile.
    const finalize = async (): Promise<string | undefined> => {
      if (!agent) return undefined;
      const reportFile = agent.reportFile;
      await agent.destroy().catch(() => {});
      agent = null;
      return copyMidsceneReport(reportFile, finalReportPath);
    };

    // Precondition: a single natural-language action handed to Midscene's
    // `aiAct` so the user can describe the desired starting state
    // ("打开计算器"、"启动 VS Code" etc.) without picking a step type.
    if (preconditionText) {
      const start = Date.now();
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} precondition start text="${preconditionText.slice(0, 120)}"`);
      try {
        await withTimeout(agent.aiAct(preconditionText), caseTimeoutMs, 'precondition');
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
        reportPath = await finalize();
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Precondition failed: ${errorMsg}`,
          report_path: reportPath,
          device,
        };
      }
    }

    // Main case content: hand the whole thing to Midscene.
    if (content) {
      const start = Date.now();
      const label = type === 'yaml' ? 'YAML 流程' : '用例内容';
      const preview = content.slice(0, 120);
      console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} content start type=${type} method=${type === 'yaml' ? 'runYaml' : 'aiAct'} timeout=${caseTimeoutMs}ms preview="${preview}"`);
      try {
        if (type === 'yaml') {
          await withTimeout(agent.runYaml(content), caseTimeoutMs, 'runYaml');
        } else {
          await withTimeout(agent.aiAct(content), caseTimeoutMs, 'aiAct');
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
        reportPath = await finalize();
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Case failed: ${errorMsg}`,
          report_path: reportPath,
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
        reportPath = await finalize();
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Checkpoint failed: ${r.error}`,
          report_path: reportPath,
          device,
        };
      }
    }
    console.log(`[executor:pc] case=${opts.caseId} exec=${opts.execId} checkpoints OK`);

    reportPath = await finalize();

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
    // Best-effort: still try to copy whatever report Midscene wrote before the crash.
    if (agent) {
      const reportFile = agent.reportFile;
      await agent.destroy().catch(() => {});
      agent = null;
      reportPath = await copyMidsceneReport(reportFile, finalReportPath);
    }
    return {
      status: 'error',
      duration_ms: totalMs,
      steps: results,
      error_message: errorMsg,
      report_path: reportPath,
      device,
    };
  }
}
