/**
 * One-shot team DB initializer.
 *
 *   npm run db:init
 *
 * What it does (same path the server runs at startup):
 *   1. CREATE DATABASE IF NOT EXISTS  (migrate.ts ensureDatabase)
 *   2. apply all pending drizzle migrations from ./drizzle
 *   3. list the resulting tables as proof
 *
 * Reads DB_URL from the environment or .env (same loader semantics as
 * scripts/dev.mjs: an already-exported shell variable wins over .env).
 */
import { existsSync, readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { runTeamMigrations } from '../src/server/db-team/migrate.js';
import { closeTeamDb } from '../src/server/db-team/client.js';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

const url = process.env.DB_URL?.trim();
if (!url) {
  console.error('[db:init] DB_URL 未配置（.env 或环境变量）- 本地模式无需初始化');
  process.exit(1);
}

const host = (() => {
  try { return new URL(url).host; } catch { return '(unparseable)'; }
})();
console.log(`[db:init] 目标: ${host}（凭据已隐藏）`);

const result = await runTeamMigrations();
if (!result.ok) {
  console.error('[db:init] ✗ 初始化失败:', result.error);
  process.exit(1);
}
console.log('[db:init] ✓ 建库 + 迁移完成');

// Proof: list tables + applied migration count.
const conn = await mysql.createConnection({ uri: url });
try {
  const [tables] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES`);
  const names = tables.map((r) => Object.values(r)[0] as string);
  const [mig] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM __drizzle_migrations`,
  );
  console.log(`[db:init] 表 (${names.length}): ${names.join(', ')}`);
  console.log(`[db:init] 已应用迁移: ${mig[0].n} 个`);
} finally {
  await conn.end();
  // runTeamMigrations leaves the shared pool open (the server keeps using it);
  // in this one-shot script we must close it or the process hangs.
  await closeTeamDb();
}
console.log('[db:init] 完成 ✓');
