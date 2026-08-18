import path from 'node:path';
import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { getTeamDb, getTeamDbUrl, isTeamDbEnabled, setTeamReady, closeTeamDb } from './client.js';

/** CREATE DATABASE IF NOT EXISTS so a fresh TiDB/MySQL needs zero manual setup. */
async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  if (!dbName) throw new Error('DB_URL must include a database name, e.g. mysql://root@127.0.0.1:4000/autotest_team');
  const serverUrl = `${u.protocol}//${u.username}${u.password ? ':' + u.password : ''}@${u.host}`;
  const conn = await mysql.createConnection(serverUrl);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
  } finally {
    await conn.end();
  }
}

/**
 * Applies pending drizzle-kit migrations at server startup.
 *
 * Idempotent — drizzle's own bookkeeping table (__drizzle_migrations) records
 * what has been applied. The migrations folder ships with the deployment
 * (repo-root /drizzle, resolved from cwd so `node dist/server/index.js` and
 * `tsx src/server/index.ts` both find it).
 *
 * On failure: team feature stays disabled (setTeamReady(false), pool closed)
 * and the local mode keeps working — a broken center DB must never take down
 * the local instance.
 */
export async function runTeamMigrations(): Promise<{ ok: boolean; applied: number; error?: string }> {
  if (!isTeamDbEnabled()) {
    return { ok: false, applied: 0, error: 'DB_URL not configured' };
  }
  const db = getTeamDb();
  if (!db) {
    return { ok: false, applied: 0, error: 'DB_URL not configured' };
  }
  try {
    await ensureDatabase(getTeamDbUrl()!);
    const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
    await migrate(db, { migrationsFolder });
    setTeamReady(true);
    return { ok: true, applied: -1 }; // count not surfaced by drizzle migrator
  } catch (err) {
    setTeamReady(false);
    await closeTeamDb();
    const message = err instanceof Error ? err.message : String(err);
    console.error('[team-db] migration failed — team feature disabled:', message);
    return { ok: false, applied: 0, error: message };
  }
}
