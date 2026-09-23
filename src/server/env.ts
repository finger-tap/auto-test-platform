import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Load the gitignored `.env` at process start so the built server
 * (`npm run start` -> dist/server/index.js) picks up the same DB_URL /
 * JWT secrets as `npm run dev` (which loads .env via scripts/dev.mjs).
 *
 * Semantics identical to scripts/dev.mjs: KEY=VALUE lines, # comments,
 * and NEVER overrides variables already exported in the shell - explicit
 * environment always wins over .env.
 *
 * Must stay the FIRST import of src/server/index.ts: other modules read
 * env vars at module-evaluation time (e.g. auth/team-jwt.ts reads
 * TEAM_JWT_SECRET), and ESM evaluates imports in order.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Works for both layouts: src/server/env.ts and dist/server/env.js are
// both exactly two levels below the project root that owns .env.
const envPath = path.resolve(__dirname, '../../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}
