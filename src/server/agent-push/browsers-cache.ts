// 2026-06-27: Cross-OS Playwright chromium cache.
//
// 问题:bundler.ts L54 之前直接读服务器本机的 PLAYWRIGHT_BROWSERS_PATH,
// 在 Mac 上 push 给 Linux VM 就会带上 mac-x64 的 binary,Linux 跑不起来。
//
// 解决:用 playwright 的 PLAYWRIGHT_HOST_PLATFORM_OVERRIDE env 让它装
// 目标 OS 的 chromium,缓存到 ~/.cache/auto-test-platform/browsers/<os>-<arch>/。
// bundler 拉包时按目标 OS 选对应缓存目录,跟 node-runtime 一个套路。

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TargetArch, TargetOs } from './node-runtime.js';

const CACHE_ROOT =
  process.env.AGENT_BROWSERS_CACHE_ROOT ||
  path.join(os.homedir(), '.cache', 'auto-test-platform', 'browsers');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLAYWRIGHT_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'playwright');

function hostPlatformFor(os: TargetOs, arch: TargetArch): string {
  if (os === 'win') return 'win64';
  if (os === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  // linux
  return arch === 'arm64' ? 'ubuntu22.04-arm64' : 'ubuntu22.04-x64';
}

function cacheDirFor(os: TargetOs, arch: TargetArch): string {
  return path.join(CACHE_ROOT, `${os}-${arch}`);
}

/**
 * Returns the cache dir containing chromium-* dirs for the target OS+arch.
 * Downloads via `playwright install chromium` with HOST_PLATFORM_OVERRIDE
 * on cache miss. Idempotent — marker file `.auto-test-platform-cache-ok`
 * short-circuits repeat calls.
 */
export async function ensureBrowsersCache(os: TargetOs, arch: TargetArch): Promise<string> {
  const cacheDir = cacheDirFor(os, arch);
  const marker = path.join(cacheDir, '.auto-test-platform-cache-ok');

  try {
    await fs.access(marker);
    console.log(`[agent-push:browsers-cache] cache hit ${os}-${arch} at ${cacheDir}`);
    return cacheDir;
  } catch {
    // miss — fall through to install
  }

  // 检查 playwright CLI 是否存在,缺失就给可操作的报错
  try {
    await fs.access(PLAYWRIGHT_BIN);
  } catch {
    throw new Error(
      `playwright CLI not found at ${PLAYWRIGHT_BIN}. Run "npm install" in project root and retry.`,
    );
  }

  await fs.mkdir(cacheDir, { recursive: true });

  const hostPlatform = hostPlatformFor(os, arch);
  const t0 = Date.now();
  console.log(
    `[agent-push:browsers-cache] downloading chromium for ${os}-${arch} (host platform override = ${hostPlatform}) into ${cacheDir} ...`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(PLAYWRIGHT_BIN, ['install', 'chromium'], {
      env: {
        ...process.env,
        PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: hostPlatform,
        PLAYWRIGHT_BROWSERS_PATH: cacheDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      process.stdout.write(`[browsers-cache] ${d}`);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      process.stderr.write(`[browsers-cache] ! ${d}`);
    });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright install chromium exited ${code}: ${stderr.slice(-500)}`));
    });
  });

  // 写 marker,bundler 看到 marker 直接走 fast path
  await fs.writeFile(marker, new Date().toISOString());

  // 校验确实装上了 chromium_headless_shell-*(agent 启动需要 headless shell)
  const entries = await fs.readdir(cacheDir, { withFileTypes: true });
  const hasHeadlessShell = entries.some(
    (e) => e.isDirectory() && e.name.startsWith('chromium_headless_shell-'),
  );
  if (!hasHeadlessShell) {
    throw new Error(
      `playwright install reported success but no chromium_headless_shell-* under ${cacheDir}. Got: ${entries.map((e) => e.name).join(', ')}`,
    );
  }

  console.log(
    `[agent-push:browsers-cache] cached at ${cacheDir} took=${Date.now() - t0}ms`,
  );
  return cacheDir;
}

/** For tests / inspection. */
export function browsersCacheDirFor(os: TargetOs, arch: TargetArch): string {
  return cacheDirFor(os, arch);
}
