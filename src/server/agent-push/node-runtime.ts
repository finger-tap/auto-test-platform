// 2026-06-27: 远端 node 二进制自包含。
//
// 用户场景:测试机可能是干净的 Linux/macOS/Windows,没装 node,而且不便上网。
// 解法:bundle 自带官方 prebuilt node,服务管理器(systemd / launchd / Windows
// Service)直接用 bundle 内的 node 启动,远端零依赖。
//
// 缓存策略:
//   首次 ensureNodeRuntime('linux','x64') 触发下载 +
//   `tar -xzf --strip-components=1`(或 win 上 `unzip`)到
//   data/node-runtime-cache/<os>-<arch>/。后续直接复用,不重复下载。
//
// 架构映射(`uname -m` 输出 → node prebuilt arch):
//   x86_64 / amd64 → x64
//   aarch64 / arm64 → arm64
//   其他 → null (push.ts 报错让用户处理)
//
// OS 映射(`uname -s` 输出 → internal os):
//   Linux   → 'linux'   (tar.gz)
//   Darwin  → 'darwin'  (tar.gz,macOS)
//   Windows → 'win'     (.zip,需要 unzip;Windows_NT 是 cmd `ver` 输出)
//
// Win 推送的服务管理层(Windows Service / schtasks / PowerShell SSH)不在
// 本模块范围;node-runtime 只负责把 node 文件准备好,具体怎么跑起来由
// push.ts 按 os 分支处理。Win 服务管理是 TODO,等真有 win 测试机再做。

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE_ROOT = path.join(PROJECT_ROOT, 'data', 'node-runtime-cache');

// 2026-06-27: 跟开发机对齐。本机 v24.15.0,选 Current 不是 LTS,但用户
// 显式选择"跟本机一致",避免远端跑出本机没遇到的 runtime 差异。
//
// 2026-06-27 (revised): 用户场景里远端可能是 CentOS 7 (glibc 2.17),Node 20+
// 要求 glibc 2.28+,直接报 "GLIBC_2.28 not found"。改成两个版本:
//   - modern: v24.15.0 (glibc >= 2.28,跟本机一致)
//   - legacy: v18.20.8 (glibc 2.17+,Node 18 是最后兼容 CentOS 7 的 LTS)
// push.ts SSH 连上后跑 `ldd --version` 探测 glibc,自动选版本。
export const NODE_VERSION_MODERN = 'v24.15.0';
export const NODE_VERSION_LEGACY = 'v18.20.8';

/**
 * 根据远端 glibc 版本选 Node 版本。规则:
 *   - glibc >= 2.28 → modern (v24.15.0)
 *   - glibc <  2.28 → legacy (v18.20.8,Node 18 是最后兼容 CentOS 7 的 LTS)
 *   - 解析失败默认 modern(让真实错误暴露在远端 ldd,而不是这里)
 *
 * 入参格式:`ldd --version` 第一行,如 "ldd (GNU libc) 2.17" / "ldd (GNU libc) 2.34"。
 */
export function pickNodeVersionForGlibc(glibcVersionString: string): string {
  const m = glibcVersionString.match(/(\d+)\.(\d+)/);
  if (!m) {
    console.warn(`[node-runtime] pickNodeVersionForGlibc: failed to parse "${glibcVersionString}", defaulting to modern`);
    return NODE_VERSION_MODERN;
  }
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  // glibc 2.28 是 Node 20+ 的最低要求。
  if (major > 2 || (major === 2 && minor >= 28)) {
    return NODE_VERSION_MODERN;
  }
  console.log(`[node-runtime] glibc ${major}.${minor} < 2.28, picking legacy node ${NODE_VERSION_LEGACY}`);
  return NODE_VERSION_LEGACY;
}

export type TargetOs = 'linux' | 'darwin' | 'win';
export type TargetArch = 'x64' | 'arm64';

const ARCH_MAP: Record<string, TargetArch> = {
  x86_64: 'x64',
  amd64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
};

const OS_MAP: Record<string, TargetOs> = {
  linux: 'linux',
  darwin: 'darwin',
  win: 'win',
  windows: 'win',
  windows_nt: 'win',
};

export function resolveArch(unameM: string): TargetArch | null {
  return ARCH_MAP[unameM.toLowerCase().trim()] ?? null;
}

export function resolveOs(unameS: string): TargetOs | null {
  return OS_MAP[unameS.toLowerCase().trim()] ?? null;
}

/** 在 bundle 内,node 二进制的相对路径(无前导 /)。win 是 bin/node.exe。 */
export function nodeBinaryBundlePath(os: TargetOs): string {
  const exe = os === 'win' ? 'node.exe' : 'node';
  return `node-runtime/bin/${exe}`;
}

/** bundle 解压后,node 二进制的绝对路径；installRoot 由 agent 类型决定。 */
export function nodeBinaryInstallPath(os: TargetOs, installRoot: string): string {
  const exe = os === 'win' ? 'node.exe' : 'node';
  // win 路径用反斜杠(installRoot 应该已是 C:\... 格式)
  if (os === 'win') {
    return `${installRoot}\\node-runtime\\bin\\${exe}`;
  }
  return `${installRoot}/node-runtime/bin/${exe}`;
}

function archiveName(os: TargetOs, arch: TargetArch, version: string): string {
  if (os === 'win') return `node-${version}-win-${arch}.zip`;
  return `node-${version}-${os}-${arch}.tar.gz`;
}

function downloadUrl(os: TargetOs, arch: TargetArch, version: string): string {
  return `https://nodejs.org/dist/${version}/${archiveName(os, arch, version)}`;
}

function cacheDirFor(os: TargetOs, arch: TargetArch, version: string): string {
  // 缓存目录带版本号,避免 modern/legacy 互相覆盖。
  // 形如 data/node-runtime-cache/linux-x64-v24.15.0/
  return path.join(CACHE_ROOT, `${os}-${arch}-${version}`);
}

/**
 * 返回本地缓存的 prebuilt node 目录路径。如果缓存不存在,下载并解压。
 * 校验 node 二进制真实存在(linux/darwin: bin/node;win: bin/node.exe 或
 * 顶层 node.exe),失败抛错。
 *
 * 2026-06-27: version 参数从 push.ts 传入(modern / legacy),根据远端 glibc
 * 自动选择。默认 NODE_VERSION_MODERN 保持向后兼容。
 */
export async function ensureNodeRuntime(
  os: TargetOs,
  arch: TargetArch,
  version: string = NODE_VERSION_MODERN,
): Promise<string> {
  const cacheDir = cacheDirFor(os, arch, version);
  const exe = os === 'win' ? 'node.exe' : 'node';
  // win prebuilt 有时把 node.exe 放在顶层而非 bin/;两个位置都接受
  const possiblePaths = os === 'win'
    ? [path.join(cacheDir, 'node.exe'), path.join(cacheDir, 'bin', 'node.exe')]
    : [path.join(cacheDir, 'bin', 'node')];
  if (possiblePaths.some(existsSync)) {
    return cacheDir;
  }

  const archive = archiveName(os, arch, version);
  const url = downloadUrl(os, arch, version);
  const archivePath = path.join(CACHE_ROOT, archive);
  await fs.mkdir(CACHE_ROOT, { recursive: true });

  if (!existsSync(archivePath)) {
    console.log(`[node-runtime] downloading ${url} -> ${archivePath} ...`);
    const t0 = Date.now();
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`download node prebuilt failed: HTTP ${resp.status} ${resp.statusText} (${url})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(archivePath, buf);
    console.log(`[node-runtime] downloaded ${buf.length} bytes took=${Date.now() - t0}ms`);
  }

  // 解压到 .extracting 临时目录,成功后 rename,避免半成品留在 cacheDir。
  // tar.gz 用 `tar -xzf --strip-components=1`(macOS/Linux 都自带);
  // zip 用 `unzip`(macOS/Linux 自带;开发机如果是 win 需要装 7zip 或
  // PowerShell Expand-Archive,但开发机一般是 mac,这里不处理)。
  const extractTmp = `${cacheDir}.extracting`;
  await fs.rm(extractTmp, { recursive: true, force: true });
  await fs.mkdir(extractTmp, { recursive: true });

  console.log(`[node-runtime] extracting ${archivePath} -> ${extractTmp} ...`);
  const t1 = Date.now();
  let extractResult: { status: number | null; stderr: string; stdout: string };
  if (os === 'win') {
    extractResult = spawnSync('unzip', ['-q', archivePath, '-d', extractTmp], { encoding: 'utf8' });
    if (extractResult.status === null || extractResult.status !== 0) {
      // unzip 可能没装,fallback 到 PowerShell Expand-Archive(macOS/Linux 上 PowerShell 也可能有)
      extractResult = spawnSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractTmp}' -Force`], { encoding: 'utf8' });
    }
    if (extractResult.status !== 0) {
      await fs.rm(extractTmp, { recursive: true, force: true });
      throw new Error(`unzip win archive failed (exit=${extractResult.status}): ${extractResult.stderr || extractResult.stdout}. Install 'unzip' or PowerShell.`);
    }
    // zip 解压出来的是 node-vX-win-x64/ 顶层目录,需要 flatten
    const entries = await fs.readdir(extractTmp, { withFileTypes: true });
    const topDir = entries.find(e => e.isDirectory());
    if (topDir) {
      const inner = path.join(extractTmp, topDir.name);
      // 把 inner/* 移到 extractTmp 根
      const innerEntries = await fs.readdir(inner);
      for (const e of innerEntries) {
        await fs.rename(path.join(inner, e), path.join(extractTmp, e));
      }
      await fs.rmdir(inner);
    }
  } else {
    extractResult = spawnSync('tar', ['-xzf', archivePath, '-C', extractTmp, '--strip-components=1'], {
      encoding: 'utf8',
    });
    if (extractResult.status !== 0) {
      await fs.rm(extractTmp, { recursive: true, force: true });
      throw new Error(`tar extract failed (exit=${extractResult.status}): ${extractResult.stderr || extractResult.stdout}`);
    }
  }
  console.log(`[node-runtime] extracted took=${Date.now() - t1}ms`);

  // 校验
  const extractedNode = possiblePaths.map(p => p.replace(cacheDir, extractTmp)).find(existsSync);
  if (!extractedNode) {
    await fs.rm(extractTmp, { recursive: true, force: true });
    throw new Error(`extraction done but node binary missing; archive may be corrupt`);
  }

  // 原子换入
  await fs.rename(extractTmp, cacheDir);
  console.log(`[node-runtime] cached at ${cacheDir}`);

  return cacheDir;
}

