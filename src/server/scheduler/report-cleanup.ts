// Phase 5.6: daily cleanup of Midscene reports older than maxAgeDays.
// Scans {root}/{testType}/{caseId}/{execId}/ recursively and removes any
// exec_id directory whose mtime is older than the threshold.
//
// 2026-06-06 (#41): scans multiple roots — the default REPORTS_ROOT
// always, plus every distinct per-user report_storage_path in
// midscene_config. Covers both legacy reports (under REPORTS_ROOT) and
// reports written by users who customized their storage path.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import { REPORTS_ROOT } from '../engine/report-paths.js';

const DEFAULT_MAX_AGE_DAYS = 30;

export interface CleanupStats {
  scanned: number;
  removed: number;
  errors: number;
  roots_scanned: number;
  duration_ms: number;
}

async function collectExtraRoots(): Promise<string[]> {
  try {
    const rows = db
      .prepare(
        "SELECT DISTINCT report_storage_path FROM midscene_config WHERE report_storage_path IS NOT NULL AND TRIM(report_storage_path) != ''"
      )
      .all() as { report_storage_path: string }[];
    return rows
      .map((r) => path.resolve(r.report_storage_path))
      .filter((p) => p !== REPORTS_ROOT);
  } catch (e) {
    console.log(`[report-cleanup] failed to read user storage paths: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// Scan a single root. Returns a partial stats object; the caller
// aggregates across roots.
async function scanRoot(root: string, cutoff: number): Promise<Pick<CleanupStats, 'scanned' | 'removed' | 'errors'>> {
  const partial = { scanned: 0, removed: 0, errors: 0 };

  let testTypeDirs: string[];
  try {
    testTypeDirs = await fs.readdir(root);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return partial; // root not created yet — fine
    partial.errors++;
    return partial;
  }

  for (const testType of testTypeDirs) {
    const testTypePath = path.join(root, testType);
    let stat;
    try {
      stat = await fs.stat(testTypePath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let caseDirs: string[];
    try {
      caseDirs = await fs.readdir(testTypePath);
    } catch {
      partial.errors++;
      continue;
    }

    for (const caseId of caseDirs) {
      const casePath = path.join(testTypePath, caseId);
      let caseStat;
      try {
        caseStat = await fs.stat(casePath);
      } catch {
        continue;
      }
      if (!caseStat.isDirectory()) continue;

      let execDirs: string[];
      try {
        execDirs = await fs.readdir(casePath);
      } catch {
        partial.errors++;
        continue;
      }

      for (const execId of execDirs) {
        const execPath = path.join(casePath, execId);
        partial.scanned++;
        try {
          const execStat = await fs.stat(execPath);
          if (execStat.isDirectory() && execStat.mtimeMs < cutoff) {
            await fs.rm(execPath, { recursive: true, force: true });
            partial.removed++;
          }
        } catch {
          partial.errors++;
        }
      }
    }
  }
  return partial;
}

export async function cleanupOldReports(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<CleanupStats> {
  const start = Date.now();
  const stats: CleanupStats = { scanned: 0, removed: 0, errors: 0, roots_scanned: 0, duration_ms: 0 };
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  // Build the list of roots to scan. Always include the default REPORTS_ROOT
  // (covers all users who haven't customized their path, plus legacy
  // reports). Add every distinct per-user override; dedupe defensively in
  // case two users happen to share a path (rare but harmless).
  const extraRoots = await collectExtraRoots();
  const roots = Array.from(new Set([REPORTS_ROOT, ...extraRoots]));
  stats.roots_scanned = roots.length;
  console.log(`[report-cleanup] scanning ${roots.length} root(s): [${roots.map((r) => r === REPORTS_ROOT ? 'default' : r).join(', ')}]`);

  for (const root of roots) {
    const partial = await scanRoot(root, cutoff);
    stats.scanned += partial.scanned;
    stats.removed += partial.removed;
    stats.errors += partial.errors;
  }

  stats.duration_ms = Date.now() - start;
  console.log(`[report-cleanup] done roots=${stats.roots_scanned} scanned=${stats.scanned} removed=${stats.removed} errors=${stats.errors} took=${stats.duration_ms}ms`);
  return stats;
}
