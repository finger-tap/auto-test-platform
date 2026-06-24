// PC preview manager — periodic desktop screenshot → SSE stream.
//
// Follows the mobile preview pattern (screenshot-relay.ts) but captures
// the server's own desktop via `screenshot-desktop` (already installed as
// a transitive dep of @midscene/computer).
//
// Protocol: Server-Sent Events
//   event: ready   → { ts }
//   event: frame   → { ts, image: "base64 PNG" }
//   event: noop    → { ts }  (screenshot failed, e.g. permission issue)
//
// Client: EventSource('GET /api/pc/preview/stream?sessionId=xxx&token=yyy')

import crypto from 'node:crypto';
import type { Response } from 'express';

const FRAME_INTERVAL_MS = 500; // ~2 FPS — enough for execution monitoring
const SCREENSHOT_TIMEOUT_MS = 5_000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min hard GC

interface PcPreviewSession {
  id: string;
  userId: number;
  createdAt: number;
  stopped: boolean;
  timer: NodeJS.Timeout | null;
  subscribers: Set<Response>;
}

const sessions = new Map<string, PcPreviewSession>();

// Lazy-load screenshot-desktop (transitive dep via @midscene/computer)
type ScreenshotFn = (opts?: { format?: string; screen?: number | string }) => Promise<Buffer>;
let _screenshot: ScreenshotFn | null = null;

async function getScreenshotFn(): Promise<ScreenshotFn> {
  if (_screenshot) return _screenshot;
  const mod = await import('screenshot-desktop');
  _screenshot = mod.default as ScreenshotFn;
  return _screenshot;
}

async function captureDesktop(): Promise<Buffer | null> {
  try {
    const screenshot = await getScreenshotFn();
    const buf = await screenshot({ format: 'png' });
    return buf.length > 0 ? buf : null;
  } catch (e) {
    console.log(`[pc-preview] screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function tick(session: PcPreviewSession): Promise<void> {
  if (session.stopped) return;

  const buf = await captureDesktop();
  const ts = Date.now();

  if (buf) {
    const image = buf.toString('base64');
    for (const res of session.subscribers) {
      try { sendSse(res, 'frame', { ts, image }); } catch { /* ignore */ }
    }
  } else {
    for (const res of session.subscribers) {
      try { sendSse(res, 'noop', { ts }); } catch { /* ignore */ }
    }
  }

  if (!session.stopped) {
    session.timer = setTimeout(() => tick(session), FRAME_INTERVAL_MS);
  }
}

export function createSession(userId: number): string {
  const id = crypto.randomUUID();
  const session: PcPreviewSession = {
    id,
    userId,
    createdAt: Date.now(),
    stopped: false,
    timer: null,
    subscribers: new Set(),
  };
  sessions.set(id, session);
  console.log(`[pc-preview] session created id=${id} userId=${userId}`);
  return id;
}

export function stopSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.stopped = true;
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  for (const res of session.subscribers) {
    try { res.end(); } catch { /* ignore */ }
  }
  session.subscribers.clear();
  sessions.delete(sessionId);
  console.log(`[pc-preview] session stopped id=${sessionId}`);
  return true;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function getSessionUserId(sessionId: string): number | undefined {
  return sessions.get(sessionId)?.userId;
}

/**
 * Attach an SSE response to a session. Starts the screenshot loop
 * on the first subscriber.
 */
export function subscribe(sessionId: string, res: Response): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.stopped) return false;

  session.subscribers.add(res);

  // Send ready event
  sendSse(res, 'ready', { ts: Date.now() });

  // Start the screenshot loop if not already running
  if (!session.timer) {
    tick(session);
  }

  // Clean up on client disconnect
  res.on('close', () => {
    session.subscribers.delete(res);
    // If no more subscribers, stop the loop (keep the session alive
    // so the client can reconnect)
    if (session.subscribers.size === 0 && session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
      console.log(`[pc-preview] session id=${sessionId} paused (no subscribers)`);
    }
  });

  console.log(`[pc-preview] subscriber added id=${sessionId} total=${session.subscribers.size}`);
  return true;
}

// Periodic GC for abandoned sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      console.log(`[pc-preview] GC expired session id=${id}`);
      stopSession(id);
    }
  }
}, 60_000);
