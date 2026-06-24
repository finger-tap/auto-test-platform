// Web test executor — Midscene PlaywrightAgent.
//
// As of 2026-06-04: cases are no longer a list of typed NL steps. The
// `case_content` + `case_content_type` columns hold either:
//   - 'text':  free-form natural language, passed to `agent.aiAct(content)`
//   - 'yaml':  Midscene flow script, passed to `agent.runYaml(content)`
// Preconditions + checkpoints remain in their own columns (still NLStep[])
// because they are typically assertions to check at the boundaries.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'url';
import path from 'path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { WebCaseRow } from '../db/web-cases.js';
import {
  generateReportPath,
  ensureReportDir,
  reportFileName,
  type TestType,
} from './report-paths.js';
import { parseNLSteps, migrateStep, isOldStep, resolveCaseContent, resolvePreconditionText, nlStepsToText, type NLStep } from './nl-steps.js';
import { applyUserMidsceneConfig, getAgentOptOverrides } from './midscene-config.js';
import { applyUserWebBrowserConfig, type ResolvedBrowserConfig } from './web-browser-config.js';
import { substituteVars } from './vars.js';
import { getDeviceForUser, type DeviceRow } from '../db/devices.js';
import {
  launchOnAgent,
  shutdownOnAgent,
  downloadReportFromAgent,
  browserConfigToLaunchParams,
  AgentError,
} from './agent-client.js';

// CRITICAL: Set PLAYWRIGHT_BROWSERS_PATH BEFORE the first 'playwright'
// import. Playwright caches the resolved registry path at module load;
// a static `import { chromium }` would freeze the env-var value as it
// is when this file is parsed (which is too early — index.ts has not
// set PBP yet). Using a dynamic import inside setupBrowser() defers
// Playwright's module init to call time, by which point the index.ts
// default has run.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  // This file lives at <projectRoot>/src/server/engine/; project root is 3 up.
  const projectRoot = path.resolve(__dirname, '../../..');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(projectRoot, 'drivers');
}

type PW = typeof import('playwright');
let _pw: PW | null = null;
async function getPW(): Promise<PW> {
  if (_pw) return _pw;
  _pw = await import('playwright');
  return _pw;
}

let _PlaywrightAgent: typeof import('@midscene/web/playwright').PlaywrightAgent | null = null;
async function getPlaywrightAgent(): Promise<typeof import('@midscene/web/playwright').PlaywrightAgent> {
  if (_PlaywrightAgent) return _PlaywrightAgent;
  const mod = await import('@midscene/web/playwright');
  _PlaywrightAgent = mod.PlaywrightAgent;
  return _PlaywrightAgent;
}

export type { NLStep, OldStep, AnyStep } from './nl-steps.js';
export { parseNLSteps, migrateStep, isOldStep, resolveCaseContent, nlStepsToText };

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
}

export interface ExecuteOptions {
  executedBy: string;
  caseId: number;
  execId: number;
  testType?: TestType;
  // The owning user's id — used to load that user's Midscene model config
  // before each case so model / API key changes take effect immediately.
  userId?: number;
  // 2026-06-06: target device. null = local in-process browser (default).
  // When set, the executor uses the agent identified by device.agent_token
  // for the launch + report cycle. See engine/agent-client.ts and
  // src/agent-web/ for the remote protocol.
  deviceId?: number | null;
  /** Environment variables for ${varName} substitution in content/preconditions/checkpoints. */
  envVars?: Record<string, string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Browser helpers
// ──────────────────────────────────────────────────────────────────────────────

type PWBrowser = import('playwright').Browser;
type PWBrowserContext = import('playwright').BrowserContext;
type PWPage = import('playwright').Page;

// Module-level singleton. Reuse a single Playwright Browser across cases in
// the same process so we don't pay the ~2-3s Chromium cold-start per run. The
// per-case BrowserContext is still created fresh so cookies/storage/state do
// not leak between cases. The shared Browser is only torn down when the case
// has `close_browser_after_execution = 1` (or admin forces a close).
//
// 2026-06-06: key now includes the device id (or 'local') so the same
// launch params against a local browser and a remote agent don't share
// state. sessionId is present only for agent mode — needed to call
// shutdownOnAgent() during cleanup.
interface SharedBrowserState {
  browser: PWBrowser;
  key: string; // identifies the launch params (browserName|headless|driverPath|executablePath|device)
  launchedAt: number;
  launches: number; // for log readability only
  device: DeviceRow | null;       // null = local in-process
  sessionId: string | undefined;  // only set in agent mode
  // For local mode, we hold a reference to the BrowserServer so we can
  // call .close() during cleanup. The connected `browser` wrapper alone
  // doesn't know how to stop the underlying server.
  localServer: import('playwright').BrowserServer | null;
}
let _sharedBrowser: SharedBrowserState | null = null;
let _sharedBrowserClosing: Promise<void> | null = null;
// 2026-06-23: serialize getSharedBrowser to prevent race where two callers
// both see _sharedBrowser=null after teardown and both launch a new browser.
let _browserMutex: Promise<void> = Promise.resolve();

// Module-level singleton (opt-in). When the user sets
// `keep_context_alive=1`, the BrowserContext + Page are also reused across
// cases so the visible page persists between runs. Cookies / storage /
// downloads state from a previous case will leak into the next one — the
// user accepted that trade-off in exchange for "page stays open between
// cases". The shared context is invalidated when:
//   1. the shared Browser is closed (cascade invalidates all contexts), or
//   2. the context key (viewport / acceptDownloads / downloadsPath / etc.)
//      changes — see browserContextKey().
// Default behavior (keep_context_alive=0) is unchanged: a fresh context is
// created per case and closed in `finally`.
interface SharedContextState {
  context: PWBrowserContext;
  page: PWPage;
  key: string;
  launchedAt: number;
  launches: number;
}
let _sharedContext: SharedContextState | null = null;

function browserLaunchKey(browserName: string, headless: boolean, browserCfg: ResolvedBrowserConfig): string {
  return `${browserName}|${headless ? '1' : '0'}|${browserCfg.driver_path || ''}|${browserCfg.executable_path || ''}|${browserCfg.chromium_sandbox ? 'sandbox' : 'nosandbox'}`;
}

/**
 * 2026-06-06: resolve a `deviceId` to the owning DeviceRow so the
 * executor can call the right agent (or fall through to local mode).
 * Throws a user-friendly error if the device id is invalid OR belongs
 * to a different user (we don't want one user to be able to launch a
 * browser on another user's remote machine). Returns null when the
 * caller asked for "no specific device" — that's the local in-process
 * case, which is still the default.
 */
export async function resolveDeviceForExecution(
  deviceId: number | null | undefined,
  userId: number | null | undefined
): Promise<DeviceRow | null> {
  if (deviceId == null) return null;
  if (!userId) {
    throw new Error('resolveDeviceForExecution: userId required to scope device lookup');
  }
  const device = await getDeviceForUser(deviceId, userId);
  if (!device) {
    throw new Error(`设备不存在或不属于当前用户 (deviceId=${deviceId})`);
  }
  if (device.test_type !== 'web') {
    throw new Error(`设备 ${device.name} 类型为 ${device.test_type}，不能用于 web 测试`);
  }
  if (device.status !== 'online') {
    throw new Error(`设备 ${device.name} 当前状态为 ${device.status}，无法执行（需要 agent 在线）`);
  }
  return device;
}

async function launchServerInProcess(
  browserName: string,
  headless: boolean,
  browserCfg: ResolvedBrowserConfig
): Promise<import('playwright').BrowserServer> {
  const browserType = browserName === 'firefox' ? 'firefox'
    : browserName === 'webkit' ? 'webkit' : 'chromium';

  // Honour the user's per-user driver override. The index.ts default sets
  // PLAYWRIGHT_BROWSERS_PATH to the bundled ./drivers dir; if the config
  // supplies its own path, swap it in for the duration of the launch and
  // restore the original value afterwards.
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  console.log(`[executor:web] launchServerInProcess: browserName=${browserName} headless=${headless} driverPath=${browserCfg.driver_path ?? '(null)'} env.PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'}`);
  if (browserCfg.driver_path) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserCfg.driver_path;
  }

  // Dynamic import so PBP is fully set (by the index.ts default at
  // process startup OR by a per-case override above) before Playwright
  // resolves its registry. A static `import { chromium }` would freeze
  // the path with whatever PBP was when this file was first parsed.
  const pw = await getPW();
  const launcher = browserType === 'firefox' ? pw.firefox
    : browserType === 'webkit' ? pw.webkit
    : pw.chromium;

  try {
    // channel:'chromium' 强制走 Google Chrome for Testing 缓存,会忽略
    // PLAYWRIGHT_BROWSERS_PATH(我们的 drivers/ 目录),改用默认 chromium build
    // 让 PLAYWRIGHT_BROWSERS_PATH 生效。
    const launchOptions: Record<string, unknown> = {
      headless,
      // Force SwiftShader software rendering. Playwright 1.60 + Chromium
      // 130+ "new headless" mode (default when `headless: true`) ships
      // without a working software-GL fallback on macOS, so
      // `page.screenshot()` and video frames come back blank. These three
      // args restore software rendering across headless + headed launches.
      // See .wolf/cerebrum.md for the bug-038 entry.
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
    };
    if (browserCfg.executable_path) {
      launchOptions.executablePath = browserCfg.executable_path;
    }
    if (!browserCfg.chromium_sandbox) {
      // docker / CI without proper user namespaces fails to spawn the
      // sandboxed renderer process. The user can flip this on explicitly.
      launchOptions.chromiumSandbox = false;
    }
    console.log(`[executor:web] launcher.launchServer headless=${headless} launcher=${browserType} PBP=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'} opts=${Object.keys(launchOptions).join(',')}`);
    return await launcher.launchServer(launchOptions as Parameters<typeof launcher.launchServer>[0]);
  } finally {
    if (browserCfg.driver_path) {
      if (previousBrowsersPath === undefined) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      } else {
        process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
      }
    }
  }
}

/**
 * 2026-06-06: acquire a browser — local or remote — and return a
 * `Browser` instance plus cleanup metadata. The Browser is always
 * obtained via `pw.chromium.connect(wsEndpoint)` so downstream code
 * (newContext, newPage, PlaywrightAgent) is identical for both modes.
 *
 * Returns:
 *   - browser:        the Playwright Browser wrapper
 *   - localServer:    the BrowserServer for local mode (so we can .close()
 *                     it during cleanup). null in agent mode.
 *   - sessionId:      agent mode only; pass to shutdownOnAgent later.
 *   - device:         the DeviceRow if any (echoed back for logging).
 */
async function acquireBrowser(
  browserName: string,
  headless: boolean,
  browserCfg: ResolvedBrowserConfig,
  device: DeviceRow | null
): Promise<{
  browser: PWBrowser;
  localServer: import('playwright').BrowserServer | null;
  sessionId: string | undefined;
}> {
  let wsEndpoint: string;
  let localServer: import('playwright').BrowserServer | null = null;
  let sessionId: string | undefined;

  if (device) {
    if (!device.agent_endpoint || !device.agent_token) {
      throw new AgentError(
        `device ${device.id} has no agent_endpoint/agent_token — cannot run remotely`,
        400
      );
    }
    const r = await launchOnAgent(
      device.agent_endpoint,
      device.agent_token,
      browserConfigToLaunchParams(browserCfg, browserName, headless)
    );
    wsEndpoint = r.wsEndpoint;
    sessionId = r.sessionId;
    console.log(`[executor:web] agent launch deviceId=${device.id} endpoint=${device.agent_endpoint} sessionId=${sessionId} wsEndpoint=${wsEndpoint}`);
  } else {
    localServer = await launchServerInProcess(browserName, headless, browserCfg);
    wsEndpoint = localServer.wsEndpoint();
    console.log(`[executor:web] local launchServer wsEndpoint=${wsEndpoint}`);
  }

  const pw = await getPW();
  // Long timeout for remote/agent mode: the WS handshake is one round-trip,
  // but the browser is already running, so this should be near-instant.
  // 10 min is just a safety net for very slow networks.
  const browser = await pw.chromium.connect(wsEndpoint, { timeout: 600_000 });
  return { browser, localServer, sessionId };
}

/**
 * Return the process-wide shared Browser, launching a new one if (a) none
 * exists yet, or (b) the launch params or device differ from the current
 * one. Each case still gets a fresh BrowserContext from the shared Browser.
 *
 * 2026-06-06: device is part of the key now — local and remote browsers
 * never share state. Caller passes `device=null` for in-process local mode,
 * or the resolved DeviceRow for agent mode.
 */
async function getSharedBrowser(
  browserName: string,
  headless: boolean,
  browserCfg: ResolvedBrowserConfig,
  device: DeviceRow | null
): Promise<PWBrowser> {
  // Serialize through the mutex so only one caller at a time can go through
  // the teardown → acquire cycle. Without this, two callers can both see
  // _sharedBrowser=null after a teardown and both launch a new browser.
  let result: PWBrowser;
  const acquire = async () => {
    const key = `${browserLaunchKey(browserName, headless, browserCfg)}|${device?.id ?? 'local'}`;

    // If a previous close is still in flight, await it before launching a new
    // one. Otherwise Playwright can throw "Browser has been closed" on
    // newContext() if the user closes mid-close.
    if (_sharedBrowserClosing) {
      await _sharedBrowserClosing.catch(() => {});
    }

    if (_sharedBrowser && _sharedBrowser.key === key) {
      _sharedBrowser.launches += 1;
      console.log(`[executor:web] reuse shared browser id=${_sharedBrowser.browser.browserType().name()} launches=${_sharedBrowser.launches} deviceId=${device?.id ?? 'local'} sessionId=${_sharedBrowser.sessionId ?? '-'} uptimeMs=${Date.now() - _sharedBrowser.launchedAt}`);
      result = _sharedBrowser.browser;
      return;
    }

    // Mismatch: tear down the old one before launching a new one so we don't
    // leak Chromium processes / agent sessions when the user toggles
    // headless/browser/driver/device.
    if (_sharedBrowser) {
      console.log(`[executor:web] shared browser params changed (old=${_sharedBrowser.key} new=${key}), closing old`);
      const old = _sharedBrowser;
      _sharedBrowser = null;
      void teardownSharedBrowser(old);
      await _sharedBrowserClosing;
    }

    const acquired = await acquireBrowser(browserName, headless, browserCfg, device);
    _sharedBrowser = {
      browser: acquired.browser,
      key,
      launchedAt: Date.now(),
      launches: 1,
      device,
      sessionId: acquired.sessionId,
      localServer: acquired.localServer,
    };
    console.log(`[executor:web] new shared browser launched id=${acquired.browser.browserType().name()} key=${key} deviceId=${device?.id ?? 'local'} sessionId=${acquired.sessionId ?? '-'}`);
    result = acquired.browser;
  };

  const next = _browserMutex.then(acquire, acquire);
  _browserMutex = next.then(() => {}, () => {});
  await next;
  return result!;
}

/**
 * Close one browser — wrapper around the in-flight close promise so the
 * caller (getSharedBrowser mismatch path or closeSharedBrowser) doesn't
 * have to repeat the cascade. Handles BOTH the Playwright browser.close()
 * AND the agent-side shutdown for remote mode. localServer.close() is
 * called for local mode so the BrowserServer process actually exits.
 */
function teardownSharedBrowser(state: SharedBrowserState): Promise<void> {
  const { browser, device, sessionId, localServer } = state;
  const localCleanup = localServer
    ? localServer.close().catch((e) => {
        console.log(`[executor:web] local BrowserServer close error: ${e instanceof Error ? e.message : String(e)}`);
      })
    : Promise.resolve();
  const remoteCleanup = device && sessionId
    ? shutdownOnAgent(device.agent_endpoint!, device.agent_token!, sessionId)
        .catch((e) => {
          // Best-effort: if the agent is already gone we don't want the
          // case failure path to surface a meaningless "shutdown failed".
          console.log(`[executor:web] shutdownOnAgent (best-effort) error: ${e instanceof Error ? e.message : String(e)}`);
        })
    : Promise.resolve();
  const browserCleanup = browser.close().catch((e) => {
    console.log(`[executor:web] shared browser close error: ${e instanceof Error ? e.message : String(e)}`);
  });
  _sharedBrowserClosing = Promise.all([localCleanup, remoteCleanup, browserCleanup])
    .then(() => undefined)
    .finally(() => { _sharedBrowserClosing = null; });
  return _sharedBrowserClosing;
}

/**
 * Force-close the shared browser. Safe to call multiple times concurrently —
 * subsequent calls await the in-flight close. Used by the admin "close
 * shared browser" endpoint and by the per-case `close_browser_after_execution`
 * flag.
 */
export async function closeSharedBrowser(): Promise<void> {
  if (!_sharedBrowser && !_sharedBrowserClosing) {
    console.log(`[executor:web] closeSharedBrowser: no shared browser to close`);
    return;
  }
  // Close the shared context first so Playwright doesn't log a cascade-close
  // warning when the parent Browser goes down. closeSharedContext is a
  // no-op if there's nothing to close.
  if (_sharedContext) {
    const oldCtx = _sharedContext;
    _sharedContext = null;
    await oldCtx.context.close().catch((e) => {
      console.log(`[executor:web] shared context close (during browser close) error: ${e instanceof Error ? e.message : String(e)}`);
    });
    console.log(`[executor:web] shared context closed (during browser close)`);
  }
  if (_sharedBrowser) {
    const old = _sharedBrowser;
    _sharedBrowser = null;
    await teardownSharedBrowser(old);
  }
  if (_sharedBrowserClosing) {
    await _sharedBrowserClosing.catch(() => {});
  }
  console.log(`[executor:web] shared browser closed`);
}

/** Diagnostic helper for the admin endpoint. */
export function getSharedBrowserInfo(): {
  key: string;
  launches: number;
  uptimeMs: number;
  deviceId: number | null;
  sessionId: string | null;
} | null {
  if (!_sharedBrowser) return null;
  return {
    key: _sharedBrowser.key,
    launches: _sharedBrowser.launches,
    uptimeMs: Date.now() - _sharedBrowser.launchedAt,
    deviceId: _sharedBrowser.device?.id ?? null,
    sessionId: _sharedBrowser.sessionId ?? null,
  };
}

function browserContextKey(windowSize: string, browserCfg: ResolvedBrowserConfig): string {
  return [
    windowSize,
    browserCfg.accept_downloads ? 'dl=on' : 'dl=off',
    browserCfg.download_dir || '',
    browserCfg.user_data_dir || '',
    browserCfg.keep_context_alive ? 'keep' : 'fresh',
  ].join('|');
}

/**
 * Return a (possibly shared) BrowserContext + Page. When
 * `keep_context_alive=true` and a shared context exists with the same key
 * AND its parent Browser is still the current shared Browser, reuse it.
 * Otherwise create a new context+page, optionally storing it as the new
 * shared instance.
 */
async function getSharedContext(
  browser: PWBrowser,
  windowSize: string,
  browserCfg: ResolvedBrowserConfig
): Promise<{ context: PWBrowserContext; page: PWPage; reused: boolean }> {
  const key = browserContextKey(windowSize, browserCfg);

  // Validate the cached context: Playwright cascade-closes all contexts when
  // the parent Browser closes, so a stale reference would throw on the next
  // goto/click. Check `browser.contexts()` to see if the ref is still alive.
  if (_sharedContext) {
    const alive = browser.contexts().includes(_sharedContext.context);
    if (!alive) {
      console.log(`[executor:web] cached shared context no longer in current browser, dropping`);
      _sharedContext = null;
    }
  }

  if (browserCfg.keep_context_alive && _sharedContext && _sharedContext.key === key) {
    _sharedContext.launches += 1;
    console.log(`[executor:web] reuse shared context launches=${_sharedContext.launches} uptimeMs=${Date.now() - _sharedContext.launchedAt} key=${key}`);
    return { context: _sharedContext.context, page: _sharedContext.page, reused: true };
  }

  // Key mismatch (or no keep flag): if we have a stale shared context, close
  // it first so we don't leak Chromium pages.
  if (_sharedContext) {
    const stale = _sharedContext;
    _sharedContext = null;
    console.log(`[executor:web] shared context key changed (old=${stale.key} new=${key}), closing old`);
    await stale.context.close().catch((e) => {
      console.log(`[executor:web] old shared context close error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  const [width, height] = windowSize.split('x').map(Number);
  const contextOptions: Record<string, unknown> = {
    viewport: { width: width || 1920, height: height || 1080 },
    // acceptDownloads defaults to true in Playwright, but we set it
    // explicitly so the user can flip it off. When off, Playwright throws
    // on any download event — useful for headless farms without fs access.
    acceptDownloads: browserCfg.accept_downloads,
  };
  if (browserCfg.download_dir) {
    contextOptions.downloadsPath = browserCfg.download_dir;
  }
  const context = await browser.newContext(contextOptions as Parameters<typeof browser.newContext>[0]);
  const page = await context.newPage();

  if (browserCfg.keep_context_alive) {
    _sharedContext = { context, page, key, launchedAt: Date.now(), launches: 1 };
    console.log(`[executor:web] new shared context launched key=${key}`);
  }
  return { context, page, reused: false };
}

async function setupBrowser(
  browserName: string,
  windowSize: string,
  headless: boolean,
  browserCfg: ResolvedBrowserConfig,
  device: DeviceRow | null
): Promise<{ browser: PWBrowser; context: PWBrowserContext; page: PWPage; reused: boolean }> {
  // Use the process-wide shared Browser; each case still gets a fresh
  // BrowserContext from it (cookies/storage isolation) UNLESS the user
  // opts in to `keep_context_alive=1`, in which case the context+page are
  // also reused across cases so the visible page persists between runs.
  const browser = await getSharedBrowser(browserName, headless, browserCfg, device);
  const { context, page, reused: contextReused } = await getSharedContext(browser, windowSize, browserCfg);

  if (browserCfg.default_timeout_ms != null && browserCfg.default_timeout_ms > 0) {
    // Affects all auto-wait + navigation timeouts on this page.
    page.setDefaultTimeout(browserCfg.default_timeout_ms);
    page.setDefaultNavigationTimeout(browserCfg.default_timeout_ms);
  }
  const reused = (_sharedBrowser ? _sharedBrowser.launches > 1 : false) || contextReused;
  return { browser, context, page, reused };
}

async function copyMidsceneReport(
  sourcePath: string | null | undefined,
  targetPath: string
): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  try {
    // sourcePath is the `index.html` Midscene wrote. The companion assets
    // (screenshots/, video files, etc.) live in the same parent dir. Copy
    // the whole directory tree so the report can resolve relative refs
    // like `./screenshots/<uuid>.jpeg` — otherwise the iframe shows
    // SVG placeholders / broken images.
    const sourceDir = path.dirname(sourcePath);
    const targetDir = path.dirname(targetPath);
    await ensureReportDir(targetPath);
    // Mirror the directory. Use a custom strategy so an existing target
    // dir doesn't fail — overwrite file-by-file under the target tree.
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    return targetPath;
  } catch (e) {
    console.log(`[executor:web] copyMidsceneReport failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * 2026-06-06: pull the gzipped tarball the agent wrote during the case
 * run and extract it under targetPath. The agent's report temp dir was
 * tared at session shutdown time (well, at case end) — the tar contains
 * the index.html + screenshots/ + video files exactly like the local
 * version. We extract directly into the per-user report root so the
 * static middleware can serve it by absolute path.
 */
async function extractAgentReport(
  device: DeviceRow,
  sessionId: string,
  targetPath: string
): Promise<string | undefined> {
  if (!device.agent_endpoint || !device.agent_token) {
    console.log(`[executor:web] extractAgentReport: device ${device.id} has no agent_endpoint/agent_token`);
    return undefined;
  }
  try {
    const targetDir = path.dirname(targetPath);
    await ensureReportDir(targetPath);
    const tarball = await downloadReportFromAgent(
      device.agent_endpoint,
      device.agent_token,
      sessionId
    );
    console.log(`[executor:web] extractAgentReport: deviceId=${device.id} sessionId=${sessionId} tarballBytes=${tarball.length} → targetDir=${targetDir}`);
    await extractTarGz(tarball, targetDir);
    return targetPath;
  } catch (e) {
    console.log(`[executor:web] extractAgentReport failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * Stream-extract a gzipped tar into destDir. Uses `tar` package if
 * installed (most common on Linux/macOS dev machines) and falls back to
 * a pure-Node ustar parser so we don't depend on the binary being on
 * PATH. Midscene reports are small (<10MB) so the in-memory path is
 * fine.
 */
async function extractTarGz(gzBuf: Buffer, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const tarBuf: Buffer = await new Promise((resolve, reject) => {
    zlib.gunzip(gzBuf, (err, out) => err ? reject(err) : resolve(out));
  });
  // Pure-Node ustar parser — handles the 512-byte header / padding /
  // two-block-end-of-archive contract. Refuses any entry that escapes
  // destDir (path traversal guard).
  const BLOCK = 512;
  let off = 0;
  while (off < tarBuf.length) {
    const header = tarBuf.subarray(off, off + BLOCK);
    off += BLOCK;
    // End-of-archive: two consecutive zero blocks.
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/g, '');
    const sizeOct = header.subarray(124, 136).toString('utf8').replace(/\0+$/g, '').trim();
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    if (!name || size < 0) {
      throw new Error(`extractTarGz: malformed tar entry (name="${name}" size=${size})`);
    }
    const target = path.join(destDir, name);
    if (!target.startsWith(destDir + path.sep) && target !== destDir) {
      throw new Error(`extractTarGz: path traversal blocked (entry="${name}")`);
    }
    const data = tarBuf.subarray(off, off + size);
    off += Math.ceil(size / BLOCK) * BLOCK;
    if (size > 0) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    } else {
      // Directory entry (size 0)
      await fs.mkdir(target, { recursive: true });
    }
  }
}

/**
 * 2026-06-06: capture the Midscene report into the per-user report root.
 * In local mode that's `copyMidsceneReport` (file copy on this server).
 * In agent mode the report lives on the remote agent's machine and must
 * be pulled over HTTP and extracted. Both paths return the absolute
 * target path on success (or undefined on failure — caller logs and
 * continues without a report).
 */
async function captureMidsceneReport(
  agentReportFile: string | null | undefined,
  targetPath: string,
  device: DeviceRow | null,
  sessionId: string | undefined
): Promise<string | undefined> {
  if (device && sessionId) {
    return extractAgentReport(device, sessionId, targetPath);
  }
  return copyMidsceneReport(agentReportFile, targetPath);
}

export async function executeWebCase(
  testCase: WebCaseRow,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();
  const { content: rawContent, type } = resolveCaseContent(
    testCase.case_content,
    testCase.case_content_type,
    testCase.steps
  );
  const rawCheckpoints = parseNLSteps(testCase.check_points);
  // Preconditions: a single natural-language task passed to Midscene's
  // `aiAct` (action). Old rows may still hold a JSON NLStep[] from the
  // legacy assertion-shaped format — resolvePreconditionText flattens
  // those into a single string so existing rows still execute.
  const rawPreconditionText = resolvePreconditionText(testCase.preconditions);

  // Substitute ${varName} placeholders with environment variable values.
  const vars = opts.envVars || {};
  const content = substituteVars(rawContent, vars);
  const preconditionText = substituteVars(rawPreconditionText, vars);
  const checkpoints = rawCheckpoints.map(cp => ({
    ...cp,
    description: substituteVars(cp.description, vars),
    ...(cp.expect ? { expect: substituteVars(cp.expect, vars) } : {}),
  }));
  const headless = testCase.headless_mode === 1;
  const browser = testCase.browser || 'chromium';
  const windowSize = testCase.window_size || '1920x1080';
  const baseUrl = testCase.base_url || '';
  const testType: TestType = opts.testType || 'web';

  if (!content && checkpoints.length === 0 && !preconditionText) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      error_message: 'No case content defined',
    };
  }

  // 2026-06-06: resolve the target device (if any). null = local
  // in-process browser. Errors here are user-visible (bad device id,
  // device belongs to a different user, etc.) — surface them as a
  // proper failure result instead of crashing the executor.
  let device: DeviceRow | null = null;
  try {
    device = await resolveDeviceForExecution(opts.deviceId, opts.userId);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} resolveDevice failed: ${errorMsg}`);
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      error_message: errorMsg,
    };
  }
  console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} target device=${device ? `id=${device.id} name="${device.name}" endpoint=${device.agent_endpoint ?? '(local)'}` : 'local'}`);

  const results: StepResult[] = [];
  let browserInstance: PWBrowser | null = null;
  let contextInstance: PWBrowserContext | null = null;
  let reportPath: string | undefined;
  const finalReportPath = generateReportPath(testType, opts.caseId, opts.execId, opts.userId);
  console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} report path resolved: ${finalReportPath} (userRoot=${opts.userId ? 'per-user' : 'default'})`);
  const reportName = reportFileName(testType, opts.caseId, opts.execId);

  // Resolve the owning user's per-user Web browser config (driver path,
  // accept downloads, user data dir, etc.) before the launch decision.
  // The web_test_cases.driver_path and close_browser_after_execution
  // columns are now ignored — the user moved both to a dedicated page.
  let browserCfg: ResolvedBrowserConfig = {
    driver_path: null,
    user_data_dir: null,
    accept_downloads: true,
    download_dir: null,
    auto_download: false,
    executable_path: null,
    chromium_sandbox: false,
    close_browser_after_execution: false,
    keep_context_alive: false,
    default_timeout_ms: null,
  };
  if (opts.userId) {
    browserCfg = await applyUserWebBrowserConfig(opts.userId, `case=${opts.caseId} exec=${opts.execId} start`);
  }
  const closeBrowserAfter = browserCfg.close_browser_after_execution;

  console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} start name="${testCase.name}" type=${type} hasContent=${!!content} hasPrecondition=${!!preconditionText} checkpoints=${checkpoints.length} baseUrl=${baseUrl || '(none)'} headless=${headless} closeBrowserAfter=${closeBrowserAfter} keepContextAlive=${browserCfg.keep_context_alive} envVars=${Object.keys(vars).length} keys=${Object.keys(vars).join(',')}`);

  // Push the owning user's Midscene model config into the live runtime
  // before any agent action. Best-effort: a failure here will surface
  // again inside agent.aiAct() so we don't need a hard throw.
  if (opts.userId) {
    try {
      await applyUserMidsceneConfig(opts.userId, `case=${opts.caseId} exec=${opts.execId} start`);
    } catch (e) {
      console.log(`[executor:web] case=${opts.caseId} applyUserMidsceneConfig failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const { browser: b, context, page, reused } = await setupBrowser(browser, windowSize, headless, browserCfg, device);
    browserInstance = b;
    contextInstance = context;
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} browser ready url=${page.url()} reusedBrowser=${reused}`);

    // If the user wants every page download auto-saved to download_dir,
    // register a download listener that resolves to a filesystem path
    // and saves with the suggested filename. accept_downloads must be on
    // (the context options already enforced that).
    //
    // When `reused` is true, the page is the kept-alive one from a previous
    // case — its download listener is already attached. Skip to avoid
    // listener accumulation across cases.
    if (browserCfg.auto_download && browserCfg.download_dir && browserCfg.accept_downloads) {
      if (reused) {
        console.log(`[executor:web] case=${opts.caseId} reusing page, auto-download listener already attached (dir=${browserCfg.download_dir})`);
      } else {
        const dlDir = browserCfg.download_dir;
        page.on('download', async (dl) => {
          try {
            const target = path.join(dlDir, dl.suggestedFilename());
            await dl.saveAs(target);
            console.log(`[executor:web] case=${opts.caseId} auto-download saved path=${target} url=${dl.url()}`);
          } catch (e) {
            console.log(`[executor:web] case=${opts.caseId} auto-download save failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
        console.log(`[executor:web] case=${opts.caseId} auto-download listener attached dir=${dlDir}`);
      }
    }

    const PlaywrightAgent = await getPlaywrightAgent();
    const agent = new PlaywrightAgent(page, {
      generateReport: true,
      outputFormat: 'html-and-external-assets',
      reportFileName: reportName,
      groupName: testCase.name,
      groupDescription: testCase.description || undefined,
      ...getAgentOptOverrides(opts.userId),
    });
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} PlaywrightAgent ready report=${reportName}`);

    if (baseUrl) {
      console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} goto baseUrl=${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} goto baseUrl failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    let stepIndex = 0;

    const runAssert = async (s: NLStep, idx: number): Promise<StepResult> => {
      const start = Date.now();
      const desc = `[检查] ${s.description}`;
      const expectText = s.expect || s.description;
      console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] start expect="${expectText.slice(0, 100)}"`);
      try {
        if (expectText) {
          const result = await agent.aiAssert(expectText);
          const ms = Date.now() - start;
          if (!result?.pass) {
            console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] FAILED ${ms}ms reason="${result?.message || 'Assertion failed'}"`);
            return {
              index: stepIndex++,
              description: desc,
              expect: expectText,
              status: 'failed',
              duration_ms: ms,
              error: result?.message || 'Assertion failed',
            };
          }
          console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] PASS ${ms}ms`);
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
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoint[${idx}] THREW ${ms}ms err="${errorMsg}"`);
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
      console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} precondition start text="${preconditionText.slice(0, 120)}"`);
      try {
        await agent.aiAct(preconditionText);
        const ms = Date.now() - start;
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} precondition OK ${ms}ms`);
        results.push({
          index: stepIndex++,
          description: `[前置] ${preconditionText}`,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} precondition FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          index: stepIndex++,
          description: `[前置] ${preconditionText}`,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        await agent.destroy().catch(() => {});
        // Failure path: still copy the partial Midscene report so the user
        // can open the report page and see WHERE the case failed (screenshots
        // / video up to the failure point). In agent mode, captureMidsceneReport
        // pulls the report from the remote agent's temp dir via HTTP.
        const copied = await captureMidsceneReport(
          agent.reportFile,
          finalReportPath,
          _sharedBrowser?.device ?? null,
          _sharedBrowser?.sessionId
        );
        if (copied) reportPath = copied;
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Precondition failed: ${errorMsg}`,
          report_path: reportPath,
        };
      }
    }

    // Main case content: hand the whole thing to Midscene.
    if (content) {
      const start = Date.now();
      const label = type === 'yaml' ? 'YAML 流程' : '用例内容';
      const preview = content.slice(0, 120);
      console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} content start type=${type} method=${type === 'yaml' ? 'runYaml' : 'aiAct'} preview="${preview}"`);
      try {
        if (type === 'yaml') {
          await agent.runYaml(content);
        } else {
          await agent.aiAct(content);
        }
        const ms = Date.now() - start;
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} content OK ${ms}ms`);
        results.push({
          index: stepIndex++,
          description: label,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} content FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          index: stepIndex++,
          description: label,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        await agent.destroy().catch(() => {});
        const copied = await captureMidsceneReport(
          agent.reportFile,
          finalReportPath,
          _sharedBrowser?.device ?? null,
          _sharedBrowser?.sessionId
        );
        if (copied) reportPath = copied;
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Case failed: ${errorMsg}`,
          report_path: reportPath,
        };
      }
    }

    // Checkpoints: assert-only.
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoints start count=${checkpoints.length}`);
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const r = await runAssert(cp, i);
      results.push(r);
      if (r.status === 'failed') {
        await agent.destroy().catch(() => {});
        const copied = await captureMidsceneReport(
          agent.reportFile,
          finalReportPath,
          _sharedBrowser?.device ?? null,
          _sharedBrowser?.sessionId
        );
        if (copied) reportPath = copied;
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          error_message: `Checkpoint failed: ${r.error}`,
          report_path: reportPath,
        };
      }
    }
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} checkpoints OK`);

    await agent.destroy().catch(() => {});
    const copied = await captureMidsceneReport(
      agent.reportFile,
      finalReportPath,
      _sharedBrowser?.device ?? null,
      _sharedBrowser?.sessionId
    );
    if (copied) {
      reportPath = copied;
    }

    const totalMs = Date.now() - globalStart;
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} done SUCCESS ${totalMs}ms steps=${results.length} report=${reportPath ?? '(none)'}`);
    return {
      status: 'success',
      duration_ms: totalMs,
      steps: results,
      report_path: reportPath,
    };
  } catch (err) {
    const totalMs = Date.now() - globalStart;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} done ERROR ${totalMs}ms err="${errorMsg}"`);
    return {
      status: 'error',
      duration_ms: totalMs,
      steps: results,
      error_message: errorMsg,
      report_path: reportPath,
    };
  } finally {
    // Close the per-case BrowserContext unless the user opted in to
    // `keep_context_alive=1` — in that case the context is stored in
    // `_sharedContext` and the next case will reuse it (along with the
    // visible page). Cookies / storage from this case will persist into
    // the next one — the user explicitly accepted that trade-off.
    if (contextInstance) {
      if (browserCfg.keep_context_alive) {
        console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} keep_context_alive=1, NOT closing context (will reuse for next case)`);
      } else {
        await contextInstance.close().catch((e) => {
          console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} context close error: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }
    if (closeBrowserAfter && browserInstance) {
      // Only close the shared Browser if it hasn't been closed/relpaced
      // by a concurrent closeSharedBrowser() call. closeSharedBrowser
      // is idempotent and a no-op when the singleton is already null.
      console.log(`[executor:web] case=${opts.caseId} exec=${opts.execId} closeBrowserAfter=1, tearing down shared browser`);
      await closeSharedBrowser();
    }
  }
}
