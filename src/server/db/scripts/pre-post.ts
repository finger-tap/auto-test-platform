/**
 * Pre/post script execution engine.
 * Scripts run in an isolated Node.js vm context with built-in functions available.
 * Database queries are supported via the `db` object injected from the environment.
 * Supports multiple named databases per environment.
 *
 * Security: the vm context is created with `codeGeneration: { strings: false }`
 * which blocks `eval()` / `new Function()` / `Function.prototype.constructor`
 * from generating code from strings inside the sandbox, closing the classic
 * `({}).constructor.constructor('return process')()` escape route.
 */

import * as vm from 'node:vm';
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

const SCRIPT_TIMEOUT_MS = 5000;
const CONDITION_TIMEOUT_MS = 1000;

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

    // Build the sandbox object. Property reads inside the script resolve
    // against this object as the script's global scope. Mutations to vars
    // happen via setVar() (which closes over the host-side scriptVars).
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

    // Hardening: prevent the script from generating new code via strings
    // (eval, new Function, Function.prototype.constructor). This blocks
    // the classic constructor-chain escape to the host realm.
    vm.createContext(sandbox, {
      name: 'pre-post-script',
      codeGeneration: { strings: false, wasm: false },
    });

    // Wrap the user script in an async IIFE so `await` works at top level.
    // The IIFE captures any `return` inside the script as a function return.
    const wrapped = `"use strict";\n(async () => { ${script} })();`;
    const compiled = new vm.Script(wrapped, { filename: 'pre-post-script.js' });

    // Capture console.log output emitted via the script's `console.log`
    const logs: unknown[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    let result: unknown;
    try {
      const promise = compiled.runInContext(sandbox, {
        timeout: SCRIPT_TIMEOUT_MS,
        displayErrors: true,
      }) as Promise<unknown>;
      // Race against a wall-clock timeout in case the script awaits
      // an unresolvable promise (vm.Script's timeout is sync-only).
      result = await Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Script execution exceeded ${SCRIPT_TIMEOUT_MS}ms timeout`)),
            SCRIPT_TIMEOUT_MS
          )
        ),
      ]);
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
    vm.createContext(sandbox, {
      name: 'pre-post-condition',
      codeGeneration: { strings: false, wasm: false },
    });
    const wrapped = `"use strict";\n(${expr});`;
    const result = new vm.Script(wrapped, { filename: 'pre-post-condition.js' }).runInContext(
      sandbox,
      { timeout: CONDITION_TIMEOUT_MS, displayErrors: true }
    );
    return Boolean(result);
  } catch {
    return false;
  }
}