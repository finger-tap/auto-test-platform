// 2026-06-06: server-side HTTP client for the agent service.
//
// The web-executor calls these helpers to launch a browser on a remote
// agent, then download the report after the case finishes. All calls
// carry `Authorization: Bearer <agent_token>`, verified by the agent's
// verifyServerRequest middleware.

import type { ResolvedBrowserConfig } from './web-browser-config.js';

export interface AgentLaunchParams {
  browserName: string;       // 'chromium' | 'firefox' | 'webkit'
  headless: boolean;
  executablePath?: string | null;
  chromiumSandbox?: boolean;
  args?: string[];
}

export interface AgentLaunchResult {
  wsEndpoint: string;
  sessionId: string;
  reportTempDir: string;
}

export interface AgentHealthResult {
  ok: boolean;
  name?: string;
  version?: string;
  activeSessions?: { launchKeys: number; sessions: unknown[] };
}

class AgentError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string) {
    super(message);
    this.name = 'AgentError';
  }
}

function authHeader(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function checkOk(res: Response, op: string): Promise<void> {
  if (res.ok) return;
  let bodyText = '';
  try { bodyText = await res.text(); } catch { /* ignore */ }
  throw new AgentError(`${op} failed: ${res.statusText || res.status} body=${bodyText.slice(0, 300)}`, res.status, bodyText);
}

/**
 * Replace the host in a wsEndpoint URL with the host from agentEndpoint.
 * Playwright's BrowserServer reports wsEndpoint as ws://127.0.0.1:<port>/...
 * but the central server needs the agent's externally-reachable host.
 */
function rewriteWsEndpointHost(wsEndpoint: string, agentEndpoint: string): string {
  try {
    const agentUrl = new URL(agentEndpoint);
    const wsUrl = new URL(wsEndpoint);
    if (wsUrl.hostname === '127.0.0.1' || wsUrl.hostname === 'localhost' || wsUrl.hostname === '0.0.0.0') {
      wsUrl.hostname = agentUrl.hostname;
    }
    return wsUrl.toString();
  } catch {
    // If URL parsing fails, return as-is (shouldn't happen with valid endpoints)
    return wsEndpoint;
  }
}

export { AgentError };

/**
 * POST /launch on the agent. Returns the wsEndpoint the central server
 * should connect to via `pw.chromium.connect()`, plus a sessionId for
 * later report download / shutdown.
 */
export async function launchOnAgent(
  agentEndpoint: string,
  agentToken: string,
  params: AgentLaunchParams
): Promise<AgentLaunchResult> {
  const url = `${agentEndpoint.replace(/\/$/, '')}/launch`;
  console.log(`[agent-client] launchOnAgent url=${url} browserName=${params.browserName} headless=${params.headless}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(agentToken),
    body: JSON.stringify(params),
  });
  await checkOk(res, 'launchOnAgent');
  const json = await res.json() as { data: AgentLaunchResult };
  if (!json?.data?.wsEndpoint || !json?.data?.sessionId) {
    throw new AgentError('launchOnAgent: malformed response (no wsEndpoint or sessionId)', 502);
  }
  // Rewrite wsEndpoint host: the agent's BrowserServer binds to 0.0.0.0 but
  // reports wsEndpoint with 127.0.0.1. Replace with the agent's reachable host
  // so the central server can connect from a different machine.
  json.data.wsEndpoint = rewriteWsEndpointHost(json.data.wsEndpoint, agentEndpoint);
  return json.data;
}

/**
 * POST /sessions/:id/shutdown — agent closes that session. Best-effort:
 * if the agent is unreachable we log and swallow, because the case has
 * already finished and the report was already (or not) downloaded.
 */
export async function shutdownOnAgent(
  agentEndpoint: string,
  agentToken: string,
  sessionId: string
): Promise<void> {
  const url = `${agentEndpoint.replace(/\/$/, '')}/sessions/${sessionId}/shutdown`;
  try {
    const res = await fetch(url, { method: 'POST', headers: authHeader(agentToken) });
    if (!res.ok) {
      console.log(`[agent-client] shutdownOnAgent non-ok status=${res.status} (best-effort)`);
    }
  } catch (e) {
    console.log(`[agent-client] shutdownOnAgent error (best-effort): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * GET /sessions/:id/report — returns the gzipped tarball bytes. Caller
 * is responsible for extracting the archive to the target report path.
 */
export async function downloadReportFromAgent(
  agentEndpoint: string,
  agentToken: string,
  sessionId: string
): Promise<Buffer> {
  const url = `${agentEndpoint.replace(/\/$/, '')}/sessions/${sessionId}/report`;
  console.log(`[agent-client] downloadReportFromAgent url=${url} sessionId=${sessionId}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${agentToken}` } });
  await checkOk(res, 'downloadReportFromAgent');
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * GET /healthz — open endpoint, no auth. Used by the UI's "测试连接"
 * button to confirm an agent is reachable before sending a heartbeat.
 */
export async function healthCheckAgent(agentEndpoint: string): Promise<AgentHealthResult> {
  const url = `${agentEndpoint.replace(/\/$/, '')}/healthz`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    return { ok: false };
  }
  const json = await res.json() as AgentHealthResult;
  return json;
}

/**
 * Map web-executor's ResolvedBrowserConfig → AgentLaunchParams. Only the
 * fields the agent cares about are sent; user_data_dir, downloads_path,
 * etc. are set per-context on the central server side, not at launch.
 */
export function browserConfigToLaunchParams(
  browserCfg: ResolvedBrowserConfig,
  browserName: string,
  headless: boolean
): AgentLaunchParams {
  return {
    browserName,
    headless,
    executablePath: browserCfg.executable_path ?? null,
    chromiumSandbox: !!browserCfg.chromium_sandbox,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-06-15: PC-agent client (remote @midscene/computer execution)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request body for pc-agent POST /execute.
 * Mirrors the agent's ExecuteRequest — we send the whole case content and
 * the agent runs it locally with @midscene/computer.
 */
export interface PcAgentExecuteRequest {
  groupName: string;
  groupDescription?: string;
  reportName: string;
  content: string;
  contentType: 'text' | 'yaml';
  preconditionText?: string;
  checkpoints: Array<{ description: string; expect?: string }>;
  /** ComputerDeviceOpt overrides: displayId, keyboardDriver, xvfbResolution, headless */
  deviceOpt?: Record<string, unknown>;
}

/** Response from pc-agent POST /execute (the `data` wrapper). */
export interface PcAgentExecuteResponse {
  sessionId: string;
  result: {
    status: 'success' | 'failed' | 'error';
    duration_ms: number;
    steps: Array<{
      index: number;
      description: string;
      expect?: string;
      status: 'success' | 'failed' | 'skipped';
      duration_ms: number;
      error?: string;
    }>;
    error_message?: string;
    report_dir?: string;
  };
}

/**
 * POST /execute on the pc-agent. Sends the whole case; the agent runs it
 * with @midscene/computer on its local desktop and returns the result.
 * Unlike web-agent's /launch, there is no back-and-forth — the agent
 * owns the entire execution from start to finish.
 */
export async function executeOnPcAgent(
  agentEndpoint: string,
  agentToken: string,
  request: PcAgentExecuteRequest
): Promise<PcAgentExecuteResponse> {
  const url = `${agentEndpoint.replace(/\/$/, '')}/execute`;
  console.log(`[agent-client:pc] executeOnPcAgent url=${url} groupName="${request.groupName}"`);
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(agentToken),
    body: JSON.stringify(request),
  });
  await checkOk(res, 'executeOnPcAgent');
  const json = await res.json() as { data: PcAgentExecuteResponse };
  if (!json?.data?.sessionId) {
    throw new AgentError('executeOnPcAgent: malformed response (no sessionId)', 502);
  }
  return json.data;
}

/**
 * GET /sessions/:id/report on the pc-agent — returns a tar.gz of the
 * Midscene report. Reuses the existing downloadReportFromAgent helper since
 * the API shape is identical.
 */
export async function downloadPcReport(
  agentEndpoint: string,
  agentToken: string,
  sessionId: string
): Promise<Buffer> {
  return downloadReportFromAgent(agentEndpoint, agentToken, sessionId);
}
