// Phase 5 (refreshed 2026-06-06): dynamic /midscene-reports/* static serving.
//
// History:
//   - Phase 5 originally mounted `express.static(REPORTS_ROOT)` so the URL
//     /midscene-reports/{testType}/{caseId}/{execId}/index.html mapped
//     directly to data/midscene-reports/{testType}/{caseId}/{execId}/index.html.
//   - 2026-06-06 (#41): REPORTS_ROOT is no longer the only place reports can
//     live. Each user may set midscene_config.report_storage_path to a
//     different absolute directory. The DB row's `report_path` column now
//     stores the exact absolute filesystem path where the executor wrote the
//     report. The static middleware must resolve the URL → DB row → fs path
//     and sendFile from there, with REPORTS_ROOT as a final fallback for
//     legacy rows whose `report_path` is missing or was written before the
//     per-user override existed.
//
// URL contract (unchanged): /midscene-reports/{testType}/{caseId}/{execId}/{subpath...}
// testType values: 'web' | 'computer' | 'mobile'
// Exec tables:     web_case_executions | pc_case_executions | mobile_case_executions

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import db from './db/index.js';
import { REPORTS_ROOT } from './engine/report-paths.js';

// URL testType → per-case execution table that holds `report_path` for it.
const EXEC_TABLE_BY_URL_TYPE: Record<string, string> = {
  web: 'web_case_executions',
  computer: 'pc_case_executions',
  mobile: 'mobile_case_executions',
};

interface CacheEntry {
  fsPath: string;
  ts: number;
}

// 5-minute TTL. Report locations never change after the executor writes
// them (a user changing report_storage_path only affects FUTURE writes),
// so cache invalidation is unnecessary — entries naturally age out.
const CACHE_TTL_MS = 5 * 60 * 1000;
const pathCache = new Map<string, CacheEntry>();

function cacheKey(testType: string, caseId: string, execId: string): string {
  return `${testType}|${caseId}|${execId}`;
}

function safeRelativeSubpath(subpath: string): string {
  // Reject anything that tries to escape the exec dir.
  if (!subpath) return '/index.html';
  if (subpath.includes('..') || subpath.startsWith('/') || subpath.includes('\\')) {
    return '';
  }
  return subpath;
}

function fallbackPath(testType: string, caseId: string, execId: string): string {
  return path.join(REPORTS_ROOT, testType, caseId, execId, 'index.html');
}

function resolveReportFsPath(testType: string, caseId: string, execId: string): string {
  const key = cacheKey(testType, caseId, execId);
  const cached = pathCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.fsPath;
  }

  const table = EXEC_TABLE_BY_URL_TYPE[testType];
  let fsPath: string | null = null;
  if (table) {
    try {
      const row = db
        .prepare(`SELECT report_path FROM ${table} WHERE id = ? AND case_id = ?`)
        .get(Number(execId), Number(caseId)) as { report_path: string | null } | undefined;
      if (row?.report_path && path.isAbsolute(row.report_path)) {
        fsPath = row.report_path;
      }
    } catch (e) {
      console.log(`[static:midscene] db lookup failed for ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!fsPath) {
    // Legacy / fallback: reports without an absolute path stored are
    // assumed to live under the default REPORTS_ROOT.
    fsPath = fallbackPath(testType, caseId, execId);
  }

  pathCache.set(key, { fsPath, ts: Date.now() });
  return fsPath;
}

export const serveMidsceneReport: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // nosniff always — same as the original express.static setup.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Strip the mount prefix → "/{testType}/{caseId}/{execId}/{subpath...}"
  const urlPath = req.path.replace(/^\/+/, '');
  const segments = urlPath.split('/');
  if (segments.length < 3) {
    return next();
  }
  const [testType, caseId, execId, ...rest] = segments;
  if (!testType || !caseId || !execId) return next();
  if (!/^\d+$/.test(caseId) || !/^\d+$/.test(execId)) return next();
  if (!EXEC_TABLE_BY_URL_TYPE[testType]) return next();

  const subpath = safeRelativeSubpath(rest.join('/'));
  if (subpath === '') {
    // Malicious path — bail out instead of attempting to sendFile.
    console.log(`[static:midscene] rejected unsafe subpath: testType=${testType} caseId=${caseId} execId=${execId} subpath="${rest.join('/')}"`);
    return res.status(400).send('Bad request');
  }

  const baseDir = resolveReportFsPath(testType, caseId, execId);
  const fsPath = subpath === '/index.html' ? baseDir : path.join(path.dirname(baseDir), subpath);
  const cacheKeyStr = cacheKey(testType, caseId, execId);
  const isCacheHit = pathCache.has(cacheKeyStr) && Date.now() - (pathCache.get(cacheKeyStr)!.ts) < CACHE_TTL_MS;

  console.log(`[static:midscene] resolved execId=${execId} fsPath=${fsPath} (cache ${isCacheHit ? 'hit' : 'miss'})`);
  // Use streaming (chunked transfer) instead of sendFile to avoid
  // ERR_CONTENT_LENGTH_MISMATCH when the report file is still being
  // written by the executor. sendFile sets Content-Length from fs.stat()
  // at request time, but the file may grow as the executor continues
  // writing — causing the browser to see fewer bytes than promised.
  try {
    const stat = fs.statSync(fsPath);
    if (!stat.isFile()) return res.status(404).send('报告文件不存在或已被删除');
    const ext = path.extname(fsPath).toLowerCase();
    const contentType: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json',
    };
    if (contentType[ext]) res.setHeader('Content-Type', contentType[ext]);
    res.setHeader('Transfer-Encoding', 'chunked');
    const stream = fs.createReadStream(fsPath);
    stream.on('error', (streamErr) => {
      console.log(`[static:midscene] stream error for ${fsPath}: ${(streamErr as NodeJS.ErrnoException).code}`);
      if (!res.headersSent) {
        res.status(404).send('报告文件不存在或已被删除');
      }
    });
    stream.pipe(res);
  } catch (e) {
    const errnoCode = (e as NodeJS.ErrnoException).code;
    console.log(`[static:midscene] stat error for ${fsPath}: ${errnoCode}`);
    if (errnoCode === 'ENOENT') {
      const fallback = fallbackPath(testType, caseId, execId);
      if (fallback !== fsPath) {
        console.log(`[static:midscene] primary not found, retrying fallback=${fallback}`);
        try {
          const stat2 = fs.statSync(fallback);
          if (!stat2.isFile()) {
            return res.status(404).send('报告文件不存在或已被删除');
          }
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Transfer-Encoding', 'chunked');
          fs.createReadStream(fallback).pipe(res);
          return;
        } catch { /* fall through to 404 */ }
      }
    }
    // Never fall through to next() (Vite SPA) — always return an error
    // response so the iframe doesn't show the project home page.
    if (errnoCode === 'EACCES' || errnoCode === 'EPERM') {
      return res.status(403).send('Permission denied — cannot read report file. Check server logs.');
    }
    return res.status(404).send('报告文件不存在或已被删除');
  }
};

export function clearMidsceneReportPathCache(): void {
  pathCache.clear();
}
