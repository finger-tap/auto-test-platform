// 2026-06-15: pc-agent core executor — runs a complete PC test case on
// THIS machine using @midscene/computer's ComputerAgent.
//
// Why the agent runs the whole case (not just "launch" like web-agent):
// ComputerDevice drives the LOCAL desktop via libnut (native keyboard/
// mouse) + screenshot-desktop (screen capture). These operations are
// bound to the physical hardware of this machine — they CANNOT be
// serialized and replayed on the central server the way a Playwright
// wsEndpoint can. So the central server sends the case data here, we run
// it to completion, and return the result + a tarballed report.
//
// The execution model (precondition → content → checkpoints) mirrors
// pc-executor.ts exactly. We duplicate the logic rather than import it
// because the server-side executor also touches the DB (executions table,
// report-paths) and the agent runs on a remote box with no DB access.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ComputerAgent, agentForComputer, overrideAIConfig } from '@midscene/computer';

export interface PcAgentStepResult {
  index: number;
  description: string;
  expect?: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
}

export interface PcAgentExecResult {
  status: 'success' | 'failed' | 'error';
  duration_ms: number;
  steps: PcAgentStepResult[];
  error_message?: string;
  report_dir?: string;   // absolute path to the report dir on this agent machine
}

// Request body sent by the central server's pc-executor remote branch.
export interface ExecuteRequest {
  groupName: string;
  groupDescription?: string;
  reportName: string;
  content: string;
  contentType: 'text' | 'yaml';
  preconditionText?: string;
  checkpoints: { description: string; expect?: string }[];
  /** Executor user id used to resolve Midscene model config from the server. */
  executorUserId?: number;
  deviceOpt: {
    displayId?: string;
    keyboardDriver?: 'applescript' | 'libnut';
    headless?: boolean;
    xvfbResolution?: string;
  };
}

interface RemoteMidsceneConfig {
  env: Record<string, string>;
  agentOpt?: Record<string, unknown>;
}

async function fetchRemoteMidsceneConfig(userId?: number): Promise<RemoteMidsceneConfig> {
  const serverUrl = process.env.AGENT_SERVER_URL;
  const token = process.env.AGENT_TOKEN;
  if (!serverUrl || !token) return { env: {} };
  const url = `${serverUrl.replace(/\/$/, '')}/api/agents/midscene-config`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(userId ? { userId } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fetch Midscene config failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json() as { data?: RemoteMidsceneConfig };
  return {
    env: json.data?.env && typeof json.data.env === 'object' ? json.data.env : {},
    agentOpt: json.data?.agentOpt && typeof json.data.agentOpt === 'object' ? json.data.agentOpt : {},
  };
}

function maskEnvForLog(env: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    masked[k] = k.includes('API_KEY') ? `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})` : v;
  }
  return masked;
}

function parseCheckpoints(raw?: string): { description: string; expect?: string }[] {
  // Minimal inline parser — we can't import nl-steps.js (it's in the
  // server engine tree and pulls in DB code). The server already parses
  // checkpoints into structured form, so this is only a fallback if the
  // server sends the raw text instead.
  if (!raw) return [];
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => ({ description: l }));
}

export async function executeOnAgent(req: ExecuteRequest): Promise<PcAgentExecResult> {
  const globalStart = Date.now();
  const results: PcAgentStepResult[] = [];

  const content = req.content;
  const contentType = req.contentType === 'yaml' ? 'yaml' : 'text';
  const preconditionText = req.preconditionText?.trim() || '';
  const checkpoints = req.checkpoints?.length ? req.checkpoints : [];

  // Temp dir for this run's Midscene report. We pass it to agentForComputer
  // via reportFileName; Midscene writes into its own tmp area and exposes
  // agent.reportFile (the .html path) after the run.
  const reportTempBase = path.join(os.tmpdir(), 'pc-agent-reports');
  await fs.mkdir(reportTempBase, { recursive: true });

  console.log(`[pc-agent:execute] start group="${req.groupName}" type=${contentType} hasContent=${!!content} hasPrecondition=${!!preconditionText} checkpoints=${checkpoints.length} user=${req.executorUserId ?? '(none)'}`);

  let agent: ComputerAgent | null = null;
  try {
    const remoteConfig = await fetchRemoteMidsceneConfig(req.executorUserId);
    overrideAIConfig(remoteConfig.env, true);
    console.log(`[pc-agent:execute] Midscene config applied keys=${Object.keys(remoteConfig.env).length} ${JSON.stringify(maskEnvForLog(remoteConfig.env))}`);

    agent = await agentForComputer({
      ...req.deviceOpt,
      ...(remoteConfig.agentOpt || {}),
      generateReport: true,
      outputFormat: 'html-and-external-assets',
      reportFileName: req.reportName,
      groupName: req.groupName,
      groupDescription: req.groupDescription || undefined,
    });
    console.log(`[pc-agent:execute] ComputerAgent ready report=${req.reportName}`);

    let stepIndex = 0;

    // Precondition
    if (preconditionText) {
      const start = Date.now();
      try {
        await agent.aiAct(preconditionText);
        const ms = Date.now() - start;
        console.log(`[pc-agent:execute] precondition OK ${ms}ms`);
        results.push({ index: stepIndex++, description: `[前置] ${preconditionText}`, status: 'success', duration_ms: ms });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const ms = Date.now() - start;
        console.log(`[pc-agent:execute] precondition FAILED ${ms}ms err="${errorMsg}"`);
        results.push({ index: stepIndex++, description: `[前置] ${preconditionText}`, status: 'failed', duration_ms: ms, error: errorMsg });
        await agent.destroy().catch(() => {});
        return { status: 'failed', duration_ms: Date.now() - globalStart, steps: results, error_message: `Precondition failed: ${errorMsg}`, report_dir: path.dirname(agent.reportFile || '') };
      }
    }

    // Main content
    if (content) {
      const start = Date.now();
      const label = contentType === 'yaml' ? 'YAML 流程' : '用例内容';
      try {
        if (contentType === 'yaml') {
          await agent.runYaml(content);
        } else {
          await agent.aiAct(content);
        }
        const ms = Date.now() - start;
        console.log(`[pc-agent:execute] content OK ${ms}ms`);
        results.push({ index: stepIndex++, description: label, status: 'success', duration_ms: ms });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const ms = Date.now() - start;
        console.log(`[pc-agent:execute] content FAILED ${ms}ms err="${errorMsg}"`);
        results.push({ index: stepIndex++, description: label, status: 'failed', duration_ms: ms, error: errorMsg });
        const reportFile = agent.reportFile;
        await agent.destroy().catch(() => {});
        return { status: 'failed', duration_ms: Date.now() - globalStart, steps: results, error_message: `Case failed: ${errorMsg}`, report_dir: reportFile ? path.dirname(reportFile) : undefined };
      }
    }

    // Checkpoints
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const expectText = cp.expect || cp.description;
      const start = Date.now();
      try {
        const result = await agent.aiAssert(expectText);
        const ms = Date.now() - start;
        if (!result?.pass) {
          console.log(`[pc-agent:execute] checkpoint[${i}] FAILED ${ms}ms`);
          results.push({ index: stepIndex++, description: `[检查] ${cp.description}`, expect: expectText, status: 'failed', duration_ms: ms, error: result?.message || 'Assertion failed' });
          const reportFile = agent.reportFile;
          await agent.destroy().catch(() => {});
          return { status: 'failed', duration_ms: Date.now() - globalStart, steps: results, error_message: `Checkpoint failed: ${result?.message || 'Assertion failed'}`, report_dir: reportFile ? path.dirname(reportFile) : undefined };
        }
        console.log(`[pc-agent:execute] checkpoint[${i}] PASS ${ms}ms`);
        results.push({ index: stepIndex++, description: `[检查] ${cp.description}`, expect: expectText, status: 'success', duration_ms: ms });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const ms = Date.now() - start;
        console.log(`[pc-agent:execute] checkpoint[${i}] THREW ${ms}ms err="${errorMsg}"`);
        results.push({ index: stepIndex++, description: `[检查] ${cp.description}`, expect: expectText, status: 'failed', duration_ms: ms, error: errorMsg });
        const reportFile = agent.reportFile;
        await agent.destroy().catch(() => {});
        return { status: 'failed', duration_ms: Date.now() - globalStart, steps: results, error_message: `Checkpoint threw: ${errorMsg}`, report_dir: reportFile ? path.dirname(reportFile) : undefined };
      }
    }

    const reportFile = agent.reportFile;
    await agent.destroy().catch(() => {});
    const totalMs = Date.now() - globalStart;
    console.log(`[pc-agent:execute] done SUCCESS ${totalMs}ms steps=${results.length}`);
    return {
      status: 'success',
      duration_ms: totalMs,
      steps: results,
      report_dir: reportFile ? path.dirname(reportFile) : undefined,
    };
  } catch (err) {
    const totalMs = Date.now() - globalStart;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`[pc-agent:execute] done ERROR ${totalMs}ms err="${errorMsg}"`);
    let report_dir: string | undefined;
    if (agent) {
      const reportFile = agent.reportFile;
      await agent.destroy().catch(() => {});
      report_dir = reportFile ? path.dirname(reportFile) : undefined;
    }
    return { status: 'error', duration_ms: totalMs, steps: results, error_message: errorMsg, report_dir };
  }
}

// Re-export the inline parser for the index.ts request handler.
export { parseCheckpoints };
