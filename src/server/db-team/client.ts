import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema/index.js';

/**
 * Team database (TiDB / MySQL) connection singleton.
 *
 * Driven by the DB_URL env var. When unset (the default local-dev setup) the
 * whole team feature is disabled: getTeamDb() returns null and the /api/team/*
 * routes (except /api/team/ping) answer 503. The local SQLite stack is never
 * touched by this module.
 *
 * Readiness: migrations run asynchronously at startup (see migrate.ts). The
 * route guard additionally checks `isTeamReady()` so requests made during the
 * migration window get a clean 503 instead of hitting half-created tables.
 */

let _pool: mysql.Pool | null = null;
let _db: MySql2Database<typeof schema> | null = null;
let _ready = false;

export type TeamDb = MySql2Database<typeof schema>;

export function getTeamDbUrl(): string | null {
  const url = process.env.DB_URL?.trim();
  return url ? url : null;
}

export function isTeamDbEnabled(): boolean {
  return getTeamDbUrl() !== null;
}

/** true once migrations have been applied successfully in this process. */
export function isTeamReady(): boolean {
  return _ready;
}

export function setTeamReady(v: boolean): void {
  _ready = v;
}

export function getTeamDb(): TeamDb | null {
  if (!isTeamDbEnabled()) return null;
  if (_db) return _db;

  const url = getTeamDbUrl()!;
  _pool = mysql.createPool({
    uri: url,
    // Center-server sizing: modest pool, TiDB tolerates concurrency well.
    connectionLimit: 16,
    waitForConnections: true,
    // Avoid mysql2 date parsing entirely — we store/read varchar timestamps.
    dateStrings: true,
    timezone: 'Z',
    enableKeepAlive: true,
  });
  _db = drizzle(_pool, { schema, mode: 'default' });
  return _db;
}

/** Lightweight liveness probe used by ops/health endpoints. */
export async function teamDbPing(): Promise<boolean> {
  const db = getTeamDb();
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeTeamDb(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
    _db = null;
  }
  _ready = false;
}
