// 2026-06-28: adb 二进制自包含。
//
// 跟 node-runtime 一样的模式:bundle 自带 adb,远端机器不需要预装。
// 下载 Android Platform Tools,解压到缓存目录,推送时打包到 bundle。
//
// 下载地址:
//   Linux:  https://dl.google.com/android/repository/platform-tools-latest-linux.zip
//   macOS:  https://dl.google.com/android/repository/platform-tools-latest-darwin.zip
//   Windows: https://dl.google.com/android/repository/platform-tools-latest-windows.zip

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TargetOs, TargetArch } from './node-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE_ROOT = path.join(PROJECT_ROOT, 'data', 'adb-runtime-cache');

function adbDownloadUrl(os: TargetOs): string {
  if (os === 'linux') return 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip';
  if (os === 'darwin') return 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip';
  // win
  return 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
}

function cacheDirFor(os: TargetOs): string {
  return path.join(CACHE_ROOT, os);
}

/**
 * Returns the cache dir containing adb binary for the target OS.
 * Downloads Android Platform Tools on cache miss. Idempotent — marker file
 * `.adb-cache-ok` short-circuits repeat calls.
 */
export async function ensureAdbRuntime(os: TargetOs): Promise<string> {
  const cacheDir = cacheDirFor(os);
  const marker = path.join(cacheDir, '.adb-cache-ok');

  try {
    await fs.access(marker);
    console.log(`[adb-runtime] cache hit ${os} at ${cacheDir}`);
    return cacheDir;
  } catch {
    // miss — fall through to download
  }

  await fs.mkdir(cacheDir, { recursive: true });

  const url = adbDownloadUrl(os);
  const zipPath = path.join(cacheDir, 'platform-tools.zip');
  const t0 = Date.now();
  console.log(`[adb-runtime] downloading adb for ${os} from ${url} into ${cacheDir} ...`);

  // Download
  const curlRes = spawnSync('curl', ['-fsSL', '-o', zipPath, url], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (curlRes.status !== 0) {
    const stderr = (curlRes.stderr || '').toString().slice(-500);
    throw new Error(`curl failed (exit=${curlRes.status}): ${stderr}`);
  }

  // Extract
  const unzipRes = spawnSync('unzip', ['-o', zipPath, '-d', cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (unzipRes.status !== 0) {
    const stderr = (unzipRes.stderr || '').toString().slice(-500);
    throw new Error(`unzip failed (exit=${unzipRes.status}): ${stderr}`);
  }

  // Clean up zip
  await fs.unlink(zipPath).catch(() => {});

  // Make adb executable
  const adbBin = path.join(cacheDir, 'platform-tools', 'adb');
  if (existsSync(adbBin)) {
    await fs.chmod(adbBin, 0o755);
  }

  // Write marker
  await fs.writeFile(marker, new Date().toISOString());

  console.log(`[adb-runtime] cached at ${cacheDir} took=${Date.now() - t0}ms`);
  return cacheDir;
}

/**
 * Returns the path to the adb binary inside the cache dir.
 */
export function adbBinaryPath(os: TargetOs): string {
  return path.join(cacheDirFor(os), 'platform-tools', 'adb');
}

/** For tests / inspection. */
export function adbCacheDirFor(os: TargetOs): string {
  return cacheDirFor(os);
}
