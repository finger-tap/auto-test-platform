import path from 'node:path';
import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { eq, sql } from 'drizzle-orm';
import { getTeamDb, getTeamDbUrl, isTeamDbEnabled, setTeamReady, closeTeamDb } from './client.js';
import { centerUsers } from './schema/org.js';
import bcrypt from 'bcryptjs';
import { nowSql } from './util.js';

/** CREATE DATABASE IF NOT EXISTS so a fresh TiDB/MySQL needs zero manual setup. */
async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  if (!dbName) throw new Error('DB_URL must include a database name, e.g. mysql://root@127.0.0.1:4000/autotest_team');
  // Drop ONLY the database path - keep credentials, port AND query params
  // (e.g. ?ssl={}) intact. TiDB Cloud rejects plaintext connections, so a
  // hand-rebuilt URL that loses the query string breaks CREATE DATABASE.
  // URL.toString() round-trips percent-encoded passwords losslessly.
  u.pathname = '/';
  const conn = await mysql.createConnection(u.toString());
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
/**
 * Seed the DEFAULT platform-admin account (2026-08-23, 用户要求):
 * on a fresh center DB (zero center_users) auto-create `admin` /
 * `admin123` with is_platform_admin=1, so a company deployment has a
 * ready-to-use 管理员账户 without "who registers first" guesswork.
 * Skipped silently when any account exists. CHANGE THE PASSWORD after
 * first login (warned in the startup log + docs).
 */
async function seedDefaultAdmin(): Promise<void> {
  const db = getTeamDb();
  if (!db) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(centerUsers);
  if (Number(n) > 0) return;
  const now = nowSql();
  await db.insert(centerUsers).values({
    account: 'admin',
    passwordHash: await bcrypt.hash('admin123', 10),
    accountType: 'email',
    nickname: '管理员',
    isPlatformAdmin: 1,
    createdAt: now,
    updatedAt: now,
  });
  console.warn('[team-db] 已播种默认管理员账户: admin / admin123（首次登录后请立即修改密码）');
}

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
    await seedDefaultAdmin();
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
