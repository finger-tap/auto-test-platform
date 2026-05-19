/**
 * Database connection pool manager.
 * Supports MySQL and PostgreSQL via dynamic import.
 * Connections are cached per (envId, dbName) to support multiple DBs per environment.
 */

import type { DbConfig } from './environments.js';

interface QueryResult {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  close(): void;
}

// Cache key: "envId/dbName"
const pools = new Map<string, QueryResult>();

function poolKey(envId: number, dbName: string): string {
  return `${envId}/${dbName}`;
}

async function createMySQLPool(cfg: DbConfig): Promise<QueryResult> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 5000,
  });

  return {
    query(sql: string, params?: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (pool.execute as any)(sql, params || []).then(([rows]: [unknown]) => rows as unknown[]);
    },
    close: () => pool.end(),
  };
}

async function createPgPool(cfg: DbConfig): Promise<QueryResult> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port || 5432,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 5,
    idleTimeoutMillis: 10000,
  });

  return {
    query(sql: string, params?: unknown[]) {
      return pool.query(sql, params || []).then(r => r.rows as unknown[]);
    },
    close: () => pool.end(),
  };
}

// Get or create a pool for the given environment + database name
export async function getPool(envId: number, dbName: string, cfg: DbConfig): Promise<QueryResult> {
  const key = poolKey(envId, dbName);
  if (pools.has(key)) return pools.get(key)!;

  let pool: QueryResult;
  if (cfg.type === 'mysql') {
    pool = await createMySQLPool(cfg);
  } else if (cfg.type === 'postgres' || cfg.type === 'postgresql') {
    pool = await createPgPool(cfg);
  } else {
    throw new Error(`Unsupported database type: ${cfg.type}`);
  }

  pools.set(key, pool);
  return pool;
}

// Close and remove pool for an environment + db name
export function closePool(envId: number, dbName?: string): void {
  if (dbName) {
    const key = poolKey(envId, dbName);
    const pool = pools.get(key);
    if (pool) { void pool.close(); pools.delete(key); }
  } else {
    // Close all pools for this env
    for (const [k, pool] of pools) {
      if (k.startsWith(`${envId}/`)) { void pool.close(); pools.delete(k); }
    }
  }
}

// Close all pools (call on server shutdown)
export function closeAllPools(): void {
  for (const [, pool] of pools) void pool.close();
  pools.clear();
}

// Test connection — returns error string or null on success
export async function testDbConnection(cfg: DbConfig): Promise<string | null> {
  try {
    const pool = await getPool(-9999 as number, 'test', cfg);
    await pool.query('SELECT 1 AS result');
    closePool(-9999 as number, 'test');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Connection failed';
  }
}