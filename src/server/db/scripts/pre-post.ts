/**
 * Pre/post script execution engine.
 * Scripts run in an isolated VM-like context with built-in functions available.
 * Database queries are supported via the `db` object injected from the environment.
 * Supports multiple named databases per environment.
 */

import { evalBuiltin, BUILTINS } from '../../engine/builtins.js';
import type { DbConfig } from '../environments.js';

export interface ScriptContext {
  // Variables from previous API nodes (extracted values)
  vars: Record<string, string>;
  // Environment variables
  env: Record<string, string>;
  // Previous API result
  prevApi?: {
    status_code: number;
    response_body: string;
    response_headers: Record<string, string>;
  };
  // Named database configs (envId → Record<dbName, DbConfig>)
  // dbConfigs: { "dbName": DbConfig }
  dbConfigs?: Record<string, DbConfig> | null;
  // Which named DB to use (if specified in pre/post config)
  dbName?: string;
}

export interface ScriptResult {
  success: boolean;
  output?: string;
  error?: string;
  // Set new/modified variables for downstream nodes
  vars?: Record<string, string>;
}

// Execute a JavaScript snippet in the sandbox
export async function executeScript(script: string, ctx: ScriptContext): Promise<ScriptResult> {
  if (!script.trim()) return { success: true };

  // Make a shallow copy of vars so setVar() mutations are captured
  const scriptVars = { ...ctx.vars };

  try {
    // Resolve db pool if available
    let dbApi: Record<string, unknown> | null = null;
    if (ctx.dbConfigs && Object.keys(ctx.dbConfigs).length > 0) {
      // Find the pool for the requested dbName, or use first available
      const dbName = ctx.dbName && ctx.dbConfigs[ctx.dbName]
        ? ctx.dbName
        : Object.keys(ctx.dbConfigs)[0];

      const { getPool } = await import('../db-pool.js');
      const cfg = ctx.dbConfigs[dbName];
      try {
        // Use a sentinel envId (0) for single-run execution context
        // Each getPool call uses the same envId but different dbName keys,
        // so they won't collide in the pool cache
        const pool = await getPool(0, dbName, cfg);
        dbApi = {
          _dbName: dbName,
          query: async (sql: string, params?: unknown[]) => {
            const rows = await pool.query(sql, params);
            return rows;
          },
        };
      } catch {
        dbApi = null;
      }
    }

    // Build the sandbox object passed into the script
    const sandbox = {
      // ── Variables ──
      // Spread env vars (read-only, not modified by script)
      ...ctx.env,
      // Spread current script vars (read via bare name, modified via setVar)
      ...scriptVars,

      // ── Built-in helpers ──
      setVar: (key: string, value: string | number | boolean | null) => {
        if (typeof key !== 'string' || !key.trim()) return;
        scriptVars[key.trim()] = String(value ?? '');
      },
      getVar: (key: string): string => {
        return scriptVars[key] ?? '';
      },

      // ── Database API ──
      db: dbApi || null,

      // ── Environment (read-only object) ──
      env: ctx.env,

      // ── Previous API result ──
      prevApi: ctx.prevApi || null,

      // ── Safe globals ──
      console: {
        log: (...args: unknown[]) => console.log('[script]', ...args),
      },
      Math,
      JSON,
      Date: { now: () => Date.now() },
      String,
      Number,
      Boolean,
      Array,
      Object,
      RegExp,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      btoa,
      atob,

      // ── Built-in functions ──
      ...Object.fromEntries(Object.entries(BUILTINS).map(([name, fn]) => [name, fn])),

      // ── Safe print ──
      print: (...args: unknown[]) => args.join(' '),
    };

    const keys = Object.keys(sandbox);
    const vals = Object.values(sandbox);

    // Build a function that has sandbox variables as local scope
    const fn = new Function(...keys, `"use strict";\nreturn (async () => { ${script} })();`);

    // Capture console.log
    const logs: unknown[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    let result: unknown;
    try {
      result = await fn(...vals);
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    return {
      success: true,
      output: output || undefined,
      vars: scriptVars,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Simple expression evaluator (for condition checks without full JS)
export function evalCondition(expr: string, ctx: ScriptContext): boolean {
  try {
    const sandbox = { ...ctx.vars, ...ctx.env };
    const keys = Object.keys(sandbox);
    const vals = Object.values(sandbox);
    const fn = new Function(...keys, `"use strict";\nreturn ${expr};`);
    const result = fn(...vals);
    return Boolean(result);
  } catch {
    return false;
  }
}