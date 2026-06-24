// Centralized path computation for Midscene execution reports.
// Default layout: <cwd>/data/midscene-reports/{testType}/{caseId}/{execId}/index.html
// Per-user override: midscene_config.report_storage_path (absolute path).
//
// 2026-06-06: added per-user root via userId. The web/pc executors pass
// opts.userId; report-paths queries midscene_config to find the user's
// custom path. Module-level cache (60s TTL) avoids re-querying on every
// case. The static middleware in src/server/index.ts uses the same
// `resolveReportRoot(userId)` helper so write-path and read-path agree.
//
// testType: 'web' | 'computer' | 'mobile'
// Static-served at /midscene-reports/... by src/server/index.ts (Phase 5).

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getMidsceneConfig } from '../db/midscene-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type TestType = 'web' | 'computer' | 'mobile';

// Default root for users without a custom report_storage_path. Kept
// module-level so it can be imported by cleanup / static middleware too.
export const REPORTS_ROOT = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'midscene-reports')
  : path.resolve(__dirname, '../../../data/midscene-reports');

// 60-second TTL cache: <userId, {root, expiresAt}>. User changes to the
// MidsceneConfig page take up to 60s to be observed on the executor side,
// which is fine — config flips are rare. The PUT handler also calls
// clearReportPathCache() so the next execution sees the new path
// immediately.
const ROOT_CACHE_TTL_MS = 60_000;
const rootCache = new Map<number, { root: string; expiresAt: number }>();

export function clearReportPathCache(userId?: number): void {
  if (userId === undefined) {
    rootCache.clear();
    return;
  }
  rootCache.delete(userId);
}

// Resolve the absolute filesystem directory where a user's Midscene
// reports should be written. Returns REPORTS_ROOT when the user has not
// configured a custom path. The resolved value is path.resolve()-ed so
// the cache key is stable even if the user input a relative path.
export function resolveReportRoot(userId?: number): string {
  if (userId == null) return REPORTS_ROOT;
  const cached = rootCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.root;

  const row = getMidsceneConfig(userId);
  const configured = row?.report_storage_path?.trim();
  const root = configured ? path.resolve(configured) : REPORTS_ROOT;

  rootCache.set(userId, { root, expiresAt: Date.now() + ROOT_CACHE_TTL_MS });
  console.log(`[report-paths] userId=${userId} resolved root=${root} (source=${configured ? 'midscene_config' : 'default REPORTS_ROOT'})`);
  return root;
}

function safeSegment(seg: number | string): string {
  return String(seg).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export function generateReportPath(
  testType: TestType,
  caseId: number | string,
  execId: number | string,
  userId?: number
): string {
  const root = resolveReportRoot(userId);
  return path.join(root, testType, safeSegment(caseId), safeSegment(execId), 'index.html');
}

export function relativeReportUrl(
  testType: TestType,
  caseId: number | string,
  execId: number | string
): string {
  return `/midscene-reports/${testType}/${safeSegment(caseId)}/${safeSegment(execId)}/index.html`;
}

export async function ensureReportDir(reportPath: string): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

export function reportFileName(
  testType: TestType,
  caseId: number | string,
  execId: number | string
): string {
  return `${testType}-case-${safeSegment(caseId)}-exec-${safeSegment(execId)}`;
}
