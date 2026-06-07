// CRITICAL: PLAYWRIGHT_BROWSERS_PATH must be set BEFORE any module that
// transitively imports 'playwright' runs. The Playwright registry caches
// the resolved browsers path at module-load time, and ./db/index.js (or
// any executor) might import playwright through its dependency graph.
// ESM hoists static imports to the top, so we set the env var via a
// pre-import script-style side effect before any other import statement.
import { fileURLToPath } from 'url';
import path from 'path';
const __early_filename = fileURLToPath(import.meta.url);
const __early_dirname = path.dirname(__early_filename);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const projectRoot = path.resolve(__early_dirname, '../..');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(projectRoot, 'drivers');
}

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import './db/index.js';
import { routes } from './routes/index.js';
import { startScheduler } from './scheduler/scheduler.js';
import { checkMock } from './mock-proxy.js';
import { serveMidsceneReport } from './midscene-reports-static.js';
import { isPushEnabled } from './agent-push/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`[playwright] __dirname=${__dirname}`);
console.log(`[playwright] projectRoot=${path.resolve(__dirname, '../..')}`);
console.log(`[playwright] PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset)'}`);
console.log(`[playwright] drivers exists=${existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH || '')}`);

// 2026-06-07: SSH push requires AGENT_SSH_KEY_SECRET to encrypt the per-device
// credentials. If the env var is missing, push/stop endpoints return 503, but
// the rest of the system (heartbeats, scheduler, executors) keeps working —
// it's a non-fatal warning at startup. The crypto module logs its own
// warning; this is just a "yes/no" status line for ops.
console.log(`[agent-push] SSH push enabled=${isPushEnabled()} (set AGENT_SSH_KEY_SECRET to enable)`);
if (!process.env.PUBLIC_SERVER_URL) {
  console.warn('[agent-push] PUBLIC_SERVER_URL not set; push will fail until it is (it should match the URL the browser uses to reach this server)');
}

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// CORS_ORIGINS: only consulted in production. Dev reflects the request
// origin (any host allowed) for friction-free local iteration.
const CORS_ORIGINS = (process.env.CORS_ORIGINS
  || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (isDev) {
  console.log('[cors] Dev mode: reflecting request origin (any host allowed)');
} else {
  console.log(`[cors] Production: allowing origins: ${CORS_ORIGINS.join(', ')}`);
}

app.use(
  cors(
    isDev
      ? { origin: true, credentials: true }
      : {
          origin: (origin, cb) => {
            if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
            return cb(new Error(`CORS: origin '${origin}' not allowed`));
          },
          credentials: true,
        }
  ),
);
app.use(express.json());

// Serve avatar files (with content-type hardening to prevent XSS via
// malicious uploads bypassing mimetype checks)
const dataDir = path.resolve(__dirname, '../../data');
app.use(
  '/avatars',
  (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    next();
  },
  express.static(path.join(dataDir, 'avatars'))
);

// Phase 5 (refreshed 2026-06-06): serve Midscene HTML reports under
// /midscene-reports/*. The middleware dynamically resolves the absolute
// filesystem path from the URL → exec row's `report_path` (which respects
// per-user midscene_config.report_storage_path). REPORTS_ROOT serves as
// fallback for legacy rows. See midscene-reports-static.ts for details.
app.use('/midscene-reports', serveMidsceneReport);

// Mock proxy: intercept requests and serve mock responses
// Only active for non-API paths (mocks are intended to intercept calls to
// external target services, never the platform's own /api/* endpoints).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((req: any, _res: any, next: any) => {
  // Skip mock interception for ALL /api/* paths so the platform's own
  // API routes (auth, scenarios, etc.) cannot be hijacked by user mocks.
  if (req.path.startsWith('/api/')) {
    return next();
  }
  checkMock(req, _res, next);
});

// API routes
app.use('/api', routes);

// Frontend serving
if (isDev) {
  // Dev: Vite middleware on same port — HMR + API together
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: path.resolve(__dirname, '../..'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Production: serve built static files
  const clientDist = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ➜  Local:   ${url}\n`);
});

// Start background scheduler
startScheduler();
