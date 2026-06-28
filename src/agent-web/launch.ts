// 2026-06-06: agent-side browser server management.
//
// This module is the agent's twin of `src/server/engine/web-executor.ts`'s
// SharedBrowserState. It owns the per-launch-params Playwright
// `BrowserServer` instances, the per-session report temp dirs, and the
// wsEndpoint handles the central server connects to.
//
// Key design choices:
//   - launchServer() returns a BrowserServer with .wsEndpoint() — the
//     central server connects to that WS URL via playwright.connect().
//   - BrowserServers are reused across sessions with the same launchKey
//     (browser + headless + executablePath + sandbox) to avoid the 2-3s
//     Chromium cold-start per case. Sessions get a unique sessionId for
//     report isolation (each session owns a unique temp dir for Midscene
//     to write into).
//   - Cleanup runs every 5 min: any launchKey with no active sessions
//     AND lastUsedAt older than 30 min is closed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  // Default: use whatever the user has installed system-wide, falling back
  // to /opt/playwright-browsers. The agent runs on a different machine
  // than the central server, so the env var must be set there (typically
  // by the deploy script / docker image / `npx playwright install`).
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.AGENT_BROWSERS_PATH || '/opt/playwright-browsers';
}

const REPORT_TEMP_ROOT = process.env.AGENT_REPORT_TEMP_ROOT || '/tmp/agent-reports';

type PW = typeof import('playwright');
let _pw: PW | null = null;
async function getPW(): Promise<PW> {
  if (_pw) return _pw;
  _pw = await import('playwright');
  return _pw;
}

export interface LaunchParams {
  browserName: string;       // 'chromium' | 'firefox' | 'webkit'
  headless: boolean;
  executablePath?: string | null;
  chromiumSandbox?: boolean;
  // Per-case launch overrides:
  args?: string[];
}

interface LaunchKeyState {
  browserServer: import('playwright').BrowserServer;
  wsEndpoint: string;
  launchParams: LaunchParams;
  createdAt: number;
  lastUsedAt: number;
  launches: number;
  // sessionId -> reportTempDir
  activeSessions: Map<string, string>;
}

const launchKeys = new Map<string, LaunchKeyState>();

function launchKeyOf(p: LaunchParams): string {
  return [
    p.browserName,
    p.headless ? '1' : '0',
    p.executablePath || '',
    p.chromiumSandbox ? 's' : 'ns',
  ].join('|');
}

async function launchServerInProcess(p: LaunchParams): Promise<import('playwright').BrowserServer> {
  const pw = await getPW();
  const launcher = p.browserName === 'firefox' ? pw.firefox
    : p.browserName === 'webkit' ? pw.webkit
    : pw.chromium;

  const opts: Record<string, unknown> = {
    headless: p.headless,
    // Bind to 0.0.0.0 so the central server can connect from another host.
    // Playwright defaults to 127.0.0.1 which is unreachable remotely.
    host: '0.0.0.0',
    // Match the central server's renderer-args — SwiftShader software
    // rendering to avoid blank screenshots in headless Chromium 130+.
    args: [
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      ...(p.args || []),
    ],
  };
  if (p.executablePath) opts.executablePath = p.executablePath;
  if (!p.chromiumSandbox) opts.chromiumSandbox = false;

  console.log(`[agent:launch] launcher.launchServer browserName=${p.browserName} headless=${p.headless} executablePath=${p.executablePath ?? '(default)'} PBP=${process.env.PLAYWRIGHT_BROWSERS_PATH}`);
  return launcher.launchServer(opts as Parameters<typeof launcher.launchServer>[0]);
}

/**
 * Get or launch a browser server matching the launch params. Returns the
 * wsEndpoint + a fresh sessionId. Multiple sessions can share the same
 * browser server; the central server connects to wsEndpoint and operates
 * the shared Chromium process.
 */
export async function getOrLaunch(
  params: LaunchParams
): Promise<{ wsEndpoint: string; sessionId: string; reportTempDir: string }> {
  const key = launchKeyOf(params);
  const now = Date.now();
  const sessionId = crypto.randomUUID();

  let state = launchKeys.get(key);
  if (!state) {
    const server = await launchServerInProcess(params);

    // Register state immediately so the close handler can find it.
    state = {
      browserServer: server,
      wsEndpoint: server.wsEndpoint(),
      launchParams: params,
      createdAt: now,
      lastUsedAt: now,
      launches: 1,
      activeSessions: new Map(),
    };
    launchKeys.set(key, state);

    // Listen for browser process exit — if Chromium dies, remove stale state
    // so the next request launches a fresh browser instead of returning a dead
    // wsEndpoint.
    server.on('close', () => {
      const s = launchKeys.get(key);
      if (s && s.browserServer === server) {
        launchKeys.delete(key);
        console.error(`[agent:launch] browser process exited unexpectedly key=${key} — stale state removed`);
      }
    });

    // Give the browser process a moment to settle. If it crashes on startup
    // (missing libs, bad flags, etc.) the 'close' handler above will fire and
    // remove the entry from launchKeys before we return a dead wsEndpoint.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (!launchKeys.has(key)) {
      // The close handler already fired — browser died immediately.
      throw new Error(`browser process crashed immediately after launch (key=${key}). Check agent logs for missing libraries or sandbox errors.`);
    }

    console.log(`[agent:launch] new browser server key=${key} wsEndpoint=${state.wsEndpoint}`);
  } else {
    state.launches += 1;
    state.lastUsedAt = now;
    console.log(`[agent:launch] reuse browser server key=${key} launches=${state.launches} uptimeMs=${now - state.createdAt} activeSessions=${state.activeSessions.size}`);
  }

  // Allocate a unique temp dir for this session's Midscene output. The
  // central server downloads this dir as a tarball after execution.
  const reportTempDir = path.join(REPORT_TEMP_ROOT, sessionId);
  await fs.mkdir(reportTempDir, { recursive: true });
  state.activeSessions.set(sessionId, reportTempDir);

  return { wsEndpoint: state.wsEndpoint, sessionId, reportTempDir };
}

/**
 * Heartbeat a session — touch the underlying launch key's lastUsedAt.
 * The session itself doesn't have a TTL — only the launch key does — so
 * this just prevents the parent browser from being closed while a long
 * case is running.
 */
export function touchSession(sessionId: string): boolean {
  for (const state of launchKeys.values()) {
    if (state.activeSessions.has(sessionId)) {
      state.lastUsedAt = Date.now();
      return true;
    }
  }
  return false;
}

export interface SessionInfo {
  sessionId: string;
  reportTempDir: string;
  browserName: string;
  headless: boolean;
  createdAt: number;
}

/**
 * Remove a session from its launch key. If the launch key has no more
 * active sessions, its browser server is still kept warm (in case the
 * central server starts another case with the same params) — only the
 * periodic cleanup will close it after the idle TTL.
 */
export async function shutdownSession(sessionId: string): Promise<boolean> {
  for (const [key, state] of launchKeys) {
    if (state.activeSessions.has(sessionId)) {
      state.activeSessions.delete(sessionId);
      console.log(`[agent:launch] session removed sessionId=${sessionId} key=${key} remainingSessions=${state.activeSessions.size}`);
      return true;
    }
  }
  return false;
}

/**
 * Resolves the temp dir for a session, for the GET /sessions/:id/report
 * handler. Returns undefined if the session is unknown.
 */
export function getSessionDir(sessionId: string): string | undefined {
  for (const state of launchKeys.values()) {
    const dir = state.activeSessions.get(sessionId);
    if (dir) return dir;
  }
  return undefined;
}

/**
 * Snapshot of all active launch keys + their sessions — used by /healthz
 * for observability.
 */
export function getActiveSessions(): { launchKeys: number; sessions: SessionInfo[] } {
  const sessions: SessionInfo[] = [];
  for (const state of launchKeys.values()) {
    for (const [sessionId, reportTempDir] of state.activeSessions) {
      sessions.push({
        sessionId,
        reportTempDir,
        browserName: state.launchParams.browserName,
        headless: state.launchParams.headless,
        createdAt: state.createdAt,
      });
    }
  }
  return { launchKeys: launchKeys.size, sessions };
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
const IDLE_TTL_MS = 30 * 60 * 1000;          // 30 min

/**
 * Periodic cleanup. Called from index.ts via setInterval. Closes any
 * launch key whose lastUsedAt is older than IDLE_TTL_MS AND which has no
 * active sessions.
 */
export function cleanupIdleLaunches(): { closed: number } {
  const now = Date.now();
  let closed = 0;
  for (const [key, state] of launchKeys) {
    if (state.activeSessions.size > 0) continue;
    if (now - state.lastUsedAt < IDLE_TTL_MS) continue;
    try {
      void state.browserServer.close();
      launchKeys.delete(key);
      closed += 1;
      console.log(`[agent:launch] cleaned up idle browser server key=${key} idleMs=${now - state.lastUsedAt}`);
    } catch (e) {
      console.log(`[agent:launch] cleanup close error key=${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { closed };
}

let _cleanupTimer: NodeJS.Timeout | null = null;
export function startCleanupLoop(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const { closed } = cleanupIdleLaunches();
    if (closed > 0) console.log(`[agent:launch] cleanup cycle closed=${closed}`);
  }, CLEANUP_INTERVAL_MS);
  _cleanupTimer.unref?.();  // don't keep the process alive just for cleanup
}

export async function shutdownAll(): Promise<void> {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
  for (const [key, state] of launchKeys) {
    try {
      await state.browserServer.close();
    } catch (e) {
      console.log(`[agent:launch] shutdown close error key=${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  launchKeys.clear();
  console.log(`[agent:launch] all browser servers closed`);
}
