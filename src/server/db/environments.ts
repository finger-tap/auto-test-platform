import db from './index.js';

export interface EnvVariable {
  key: string;
  value: string;
  description?: string;
  enabled?: boolean;
}

export interface Environment {
  id: number;
  user_id: number;
  name: string;
  variables: EnvVariable[];
  ssl_cert: string | null;
  ssl_key: string | null;
  timeout: number;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  // Multiple database connections
  databases?: string; // JSON array of DatabaseEntry
}

// Single database connection entry
export interface DatabaseEntry {
  name: string;       // User-defined alias, e.g. "用户库"、"订单库"
  type: string;       // 'mysql' | 'postgres'
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DbConfig {
  type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function findEnvsByUserId(userId: number): Environment[] {
  return db.prepare(`
    SELECT * FROM environments
    WHERE user_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(userId) as Environment[];
}

export function findEnvById(id: number, userId: number): Environment | null {
  return db.prepare('SELECT * FROM environments WHERE id = ? AND user_id = ?').get(id, userId) as Environment | null;
}

export function findDefaultEnv(userId: number): Environment | null {
  return db.prepare('SELECT * FROM environments WHERE user_id = ? AND is_default = 1').get(userId) as Environment | null;
}

export function createEnv(userId: number, name: string, vars: EnvVariable[] = [], opts?: {
  ssl_cert?: string; ssl_key?: string; timeout?: number; is_default?: boolean;
  databases?: DatabaseEntry[];
}): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO environments (user_id, name, variables, ssl_cert, ssl_key, timeout, is_default, databases, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, name,
    JSON.stringify(vars),
    opts?.ssl_cert ?? null,
    opts?.ssl_key ?? null,
    opts?.timeout ?? 30000,
    opts?.is_default ? 1 : 0,
    JSON.stringify(opts?.databases ?? []),
    now, now
  );
  return result.lastInsertRowid as number;
}

export function updateEnv(id: number, userId: number, patch: Partial<{
  name: string;
  variables: EnvVariable[];
  ssl_cert: string | null;
  ssl_key: string | null;
  timeout: number;
  is_default: boolean;
  databases: DatabaseEntry[];
}>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) { fields.push('name = ?'); vals.push(patch.name); }
  if (patch.variables !== undefined) { fields.push('variables = ?'); vals.push(JSON.stringify(patch.variables)); }
  if (patch.ssl_cert !== undefined) { fields.push('ssl_cert = ?'); vals.push(patch.ssl_cert); }
  if (patch.ssl_key !== undefined) { fields.push('ssl_key = ?'); vals.push(patch.ssl_key); }
  if (patch.timeout !== undefined) { fields.push('timeout = ?'); vals.push(patch.timeout); }
  if (patch.is_default !== undefined) {
    fields.push('is_default = ?');
    vals.push(patch.is_default ? 1 : 0);
  }
  if (patch.databases !== undefined) {
    fields.push('databases = ?');
    vals.push(JSON.stringify(patch.databases));
  }

  if (fields.length === 0) return;
  
  // Reset other defaults if setting this one as default
  if (patch.is_default) {
    db.prepare('UPDATE environments SET is_default = 0 WHERE user_id = ?').run(userId);
  }

  vals.push(new Date().toISOString(), id, userId);

  db.prepare(`UPDATE environments SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...vals);
}

export function deleteEnv(id: number, userId: number): void {
  db.prepare('DELETE FROM environments WHERE id = ? AND user_id = ?').run(id, userId);
}

// Returns key:value map for variable substitution
export function envToMap(env: Environment): Record<string, string> {
  const map: Record<string, string> = {};
  if (!env.variables) return map;
  for (const v of env.variables) {
    if (v.enabled !== false && v.key) {
      map[v.key] = v.value;
    }
  }
  return map;
}

// Returns all database configs indexed by name for the given environment
export function envToDbConfigs(env: Environment | null): Record<string, DbConfig> | null {
  if (!env || !env.databases) return null;
  try {
    const dbs: DatabaseEntry[] = JSON.parse(env.databases);
    if (!Array.isArray(dbs) || dbs.length === 0) return null;
    const result: Record<string, DbConfig> = {};
    for (const db of dbs) {
      if (db.name && db.host) {
        result[db.name] = {
          type: db.type || 'mysql',
          host: db.host,
          port: db.port || (db.type === 'mysql' ? 3306 : 5432),
          user: db.user || '',
          password: db.password || '',
          database: db.database || '',
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

// Get single DB config by name
export function getDbConfigByName(env: Environment | null, dbName: string): DbConfig | null {
  const configs = envToDbConfigs(env);
  if (!configs) return null;
  return configs[dbName] ?? null;
}

// Get first DB config (for backward compatibility / default)
export function envToDbConfig(env: Environment | null): DbConfig | null {
  if (!env || !env.databases) return null;
  try {
    const dbs: DatabaseEntry[] = JSON.parse(env.databases);
    if (!Array.isArray(dbs) || dbs.length === 0) return null;
    const first = dbs.find(d => d.host) || dbs[0];
    return {
      type: first.type || 'mysql',
      host: first.host,
      port: first.port || (first.type === 'mysql' ? 3306 : 5432),
      user: first.user || '',
      password: first.password || '',
      database: first.database || '',
    };
  } catch {
    return null;
  }
}