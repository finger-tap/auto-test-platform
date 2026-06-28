// 2026-06-07: build a gzipped tarball that contains everything the remote
// agent needs to run, then push it via SSH.
//
// Bundle layout (root of the tar):
//   agent-src/             # src/agent-web/*.{ts,json,md}, flat list
//   package.json           # minimal manifest, version == DEPLOY_VERSION
//   node_modules/          # server's full node_modules
//                          #   (~450MB; chosen to avoid depending on
//                          #    the remote's network for `npm install`).
//   browsers/              # chromium-* dirs from PLAYWRIGHT_BROWSERS_PATH.
//                          #   firefox/webkit/ffmpeg omitted — the agent
//                          #   only uses chromium.
//   DEPLOY_VERSION         # the package.json version string, for sanity
//                          #   checks on the remote.
//   bundle.sha256          # sha256 of every other file, one per line, format
//                          #   `<sha>  <filename>`. The remote runs
//                          #   `sha256sum -c bundle.sha256` to fail closed
//                          #   on a corrupt download.
//
// Streamed output: the tar/gz runs as a Node Readable so we don't hold
// the whole bundle in memory. Each file's sha256 is computed inline as
// the bytes go out, and the bundle.sha256 manifest is emitted last so
// the remote can verify integrity end-to-end.

import { promises as fs, createReadStream } from 'node:fs';
import { createGzip, type Gzip } from 'node:zlib';
import { PassThrough, type Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureNodeRuntime, type TargetOs, type TargetArch } from './node-runtime.js';
import { ensureBrowsersCache } from './browsers-cache.js';
import { ensureAdbRuntime } from './adb-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root = src/server/agent-push/bundler.ts → 3 levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const AGENT_SRC = path.join(PROJECT_ROOT, 'src', 'agent-web');
// 2026-06-08: mobile-agent 跟 web-agent 平级,同一份 bundle 也带上
const MOBILE_AGENT_SRC = path.join(PROJECT_ROOT, 'src', 'agent-mobile');
// 2026-06-27: web/mobile agents ship their COMPILED .js (tsc output), not
// the .ts source — same as pc-agent. systemd ExecStart runs `node index.js`,
// and bare node can't execute TypeScript. Before bundling, run
// `npm run build:agent` (web) or `build:agent-mobile` (mobile) — push.ts
// does this automatically via ensureAgentBuild().
const WEB_AGENT_DIST = path.join(PROJECT_ROOT, 'dist', 'agent-web');
const MOBILE_AGENT_DIST = path.join(PROJECT_ROOT, 'dist', 'agent-mobile');
// 2026-06-15: pc-agent is compiled (tsc) before bundling, so we package the
// .js output from dist/agent-pc/ (which also includes the compiled
// agent-web re-exports). The bundler walks this tree and maps it into the
// tar as pc-agent-src/.
const PC_AGENT_DIST = path.join(PROJECT_ROOT, 'dist', 'agent-pc');
const NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');
const BROWSERS_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(PROJECT_ROOT, 'drivers');
const PKG_PATH = path.join(PROJECT_ROOT, 'package.json');

const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK);

// ── Tar header assembly (ustar format) ──

function tarHeader(name: string, size: number, mtime: number, typeFlag = '0', mode: number = 0o644, linkTarget?: string): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name.slice(0, 99), 0, 100, 'utf8');
  // 2026-06-27: mode 字段(offset 100, 7 octal digits + NUL)之前硬编码 0000644,
  // 让所有文件解压后都是 -rw-r--r--。但 bundle 内含 prebuilt node 二进制(应
  // 755),systemd ExecStart 调用时 status=203/EXEC。修法:接受 mode 参数,从
  // 源文件 stat.mode 取低位 9 bit。
  buf.write((mode & 0o777).toString(8).padStart(7, '0'), 100, 7, 'utf8'); buf.write('\0', 107, 1, 'utf8');
  buf.write('0000000', 108, 7, 'utf8'); buf.write('\0', 115, 1, 'utf8');
  buf.write('0000000', 116, 7, 'utf8'); buf.write('\0', 123, 1, 'utf8');
  buf.write(size.toString(8).padStart(11, '0'), 124, 11, 'utf8'); buf.write('\0', 135, 1, 'utf8');
  // GNU tar 1.27+ treats mtime < 1980-01-01 as a fatal "implausibly old time stamp" error,
  // breaking extraction on Linux. Clamp to a safe floor (1980-01-01 UTC = 315532800).
  const safeMtime = Math.max(315532800, Math.floor(mtime));
  buf.write(safeMtime.toString(8).padStart(11, '0'), 136, 11, 'utf8'); buf.write('\0', 147, 1, 'utf8');
  for (let i = 148; i < 156; i++) buf.write(' ', i, 1, 'utf8');
  buf.write(typeFlag, 156, 1, 'utf8');
  // 2026-06-27: symlink target。ustar linkname 字段在 offset 157, 长度 100。
  // 仅当 typeFlag='2' (symlink) 时使用; 其他 typeflag 这部分填 0(已 alloc)。
  if (linkTarget) {
    buf.write(linkTarget.slice(0, 99), 157, 100, 'utf8');
  }
  // ustar magic + version: makes GNU tar parse as ustar (more lenient on name encoding).
  buf.write('ustar\0', 257, 6, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'utf8');
  buf.write('\0 ', 154, 2, 'utf8');
  return buf;
}

function dirHeader(name: string, mtime: number): Buffer {
  // 目录必须 0o755(rwxr-xr-x) — 否则解压后无法 cd / list 目录内容。
  // 之前继承 tarHeader 默认 0o644,目录没 x 位,理论上 tar 解压时会自动补
  // (GNU tar 对目录 typeflag 强制 +x),但显式写 0o755 更可靠。
  return tarHeader(name.endsWith('/') ? name : name + '/', 0, mtime, '5', 0o755);
}

/**
 * 2026-06-27: GNU @LongLink extension for paths > 99 bytes.
 *
 * ustar name field is 100 bytes (99 chars + NUL). When a real path exceeds
 * that, the bundler used to slice(0, 99), which silently truncated dir
 * entries and stripped the trailing '/' — GNU tar then fails with
 * "Skipping to next header". bsdtar tolerates this, so the issue only
 * surfaced on the remote Linux box.
 *
 * The GNU LongLink extension: emit a synthetic header with
 * name='././@LongLink', typeflag='L', and size=fullPathBytes+1, followed
 * by the full path as data. The next header (with truncated name) is then
 * ignored in favor of the LongLink content. Both GNU tar and bsdtar
 * recognize this extension.
 */
const LONG_LINK_NAME = '././@LongLink';

async function writeLongLinkIfNeeded(
  gz: Gzip,
  waitForDrain: () => Promise<void>,
  name: string,
): Promise<void> {
  if (Buffer.byteLength(name, 'utf8') <= 99) return;
  const payload = Buffer.concat([Buffer.from(name, 'utf8'), Buffer.from([0])]);
  if (!gz.write(tarHeader(LONG_LINK_NAME, payload.length, 0, 'L'))) await waitForDrain();
  if (!gz.write(payload)) await waitForDrain();
  const rem = payload.length % BLOCK;
  if (rem !== 0) {
    const pad = Buffer.alloc(BLOCK - rem);
    if (!gz.write(pad)) await waitForDrain();
  }
}

interface BundleFile {
  abs: string;
  rel: string;
  size: number;
  mtime: number;
  /** 2026-06-27: 源文件 stat.mode & 0o777。tar header 用这个写权限位,
   *  让 prebuilt node 二进制 / npm / npx 解压后保留 +x,systemd/launchd
   *  才能直接 ExecStart。之前硬编码 0o644 导致 status=203/EXEC。 */
  mode: number;
  /** 2026-06-27: symlink 目标(readlink 结果)。node prebuilt bin/npm、
   *  bin/npx、bin/corepack 都是 symlink,不打包的话远端 node 能跑但
   *  npm/npx 缺失。tar typeflag='2',linkname 字段填这个。 */
  linkTarget?: string;
  /** For generated files (DEPLOY_VERSION), the content goes here. */
  generated?: string;
}

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

async function walkDir(
  abs: string,
  rel: string,
  files: BundleFile[],
  dirs: BundleFile[],
  shouldInclude?: (rel: string) => boolean,
  onProgress?: (info: { phase: string; files: number; dirs: number }) => void,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    console.warn(`[agent-push:bundler] walkDir readdir failed for ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name)) continue;
    const childAbs = path.join(abs, e.name);
    const childRel = `${rel}/${e.name}`;
    if (shouldInclude && !shouldInclude(childRel)) continue;
    if (e.isDirectory()) {
      dirs.push({ abs: childAbs, rel: childRel + '/', size: 0, mtime: 0, mode: 0o755 });
      await walkDir(childAbs, childRel, files, dirs, shouldInclude, onProgress);
    } else if (e.isSymbolicLink()) {
      // 2026-06-27: node prebuilt bin/npm、bin/npx、bin/corepack 都是 symlink
      // 指向 ../lib/node_modules/.../xxx.js。用 fs.readlink 拿目标字符串,
      // tar header typeflag='2' 写 linkname 字段。远端 tar 解压时自动重建 symlink。
      try {
        const target = await fs.readlink(childAbs);
        const st = await fs.lstat(childAbs);
        files.push({ abs: childAbs, rel: childRel, size: 0, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777, linkTarget: target });
      } catch {
        // race: link disappeared mid-walk, skip
      }
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(childAbs);
        files.push({ abs: childAbs, rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777 });
      } catch {
        // race: file disappeared mid-walk, skip
      }
    }
  }
  // Emit progress every 5000 files so the caller knows enumeration is alive
  if (onProgress && files.length % 5000 < entries.length) {
    onProgress({ phase: rel, files: files.length, dirs: dirs.length });
  }
}

/**
 * Enumerate the files we want to include. Doesn't read contents — we
 * stream each one inside createBundleStream so the tar doesn't need to
 * hold the whole bundle in memory.
 */
export type AgentBundleKind = 'web' | 'mobile' | 'pc';

export type EnumerateProgressFn = (info: { phase: string; files: number; dirs: number }) => void;

async function enumerate(
  kind: AgentBundleKind,
  onProgress?: EnumerateProgressFn,
  nodeRuntime?: { os: TargetOs; arch: TargetArch; version: string },
  browsers?: { os: TargetOs; arch: TargetArch },
  adbRuntime?: TargetOs,
): Promise<{ files: BundleFile[]; dirs: BundleFile[]; version: string; totalBytes: number }> {
  const pkgRaw = await fs.readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw) as { version: string };

  const files: BundleFile[] = [];
  const dirs: BundleFile[] = [];

  if (kind === 'web') {
    // 1. dist/agent-web/** — compiled JS output of src/agent-web/.
    // systemd ExecStart runs `node agent-src/index.js`, so we ship .js not .ts.
    const webDistExists = await fs.access(WEB_AGENT_DIST).then(() => true).catch(() => false);
    if (!webDistExists) throw new Error('Web agent bundle missing: run "npm run build:agent" before pushing a web device');
    await walkDir(WEB_AGENT_DIST, 'agent-src', files, dirs, (rel) => /\.(js|json)$/.test(rel));
    dirs.push({ abs: WEB_AGENT_DIST, rel: 'agent-src/', size: 0, mtime: 0, mode: 0o755 });
  }

  if (kind === 'mobile') {
    // 1b. dist/agent-mobile/** — compiled JS output of src/agent-mobile/.
    // systemd ExecStart runs `node mobile-agent-src/index.js`.
    const mobileDistExists = await fs.access(MOBILE_AGENT_DIST).then(() => true).catch(() => false);
    if (!mobileDistExists) throw new Error('Mobile agent bundle missing: run "npm run build:agent-mobile" before pushing a mobile device');
    await walkDir(MOBILE_AGENT_DIST, 'mobile-agent-src', files, dirs, (rel) => /\.(js|json)$/.test(rel));
    dirs.push({ abs: MOBILE_AGENT_DIST, rel: 'mobile-agent-src/', size: 0, mtime: 0, mode: 0o755 });

    // 1c. src/agent-mobile/bin/scrcpy-server — mobile-agent 启动 scrcpy 用的 Java jar
    // (从 midscene android-playground 同步过来),tar 里走 mobile-agent-bin/scrcpy-server
    // 一并存到远端,启动时通过 CLASSPATH 加载。非 ts 资源,tsc 不编译,从 src 直接打包。
    const mobileBin = path.join(MOBILE_AGENT_SRC, 'bin');
    const mobileBinExists = await fs.access(mobileBin).then(() => true).catch(() => false);
    if (mobileBinExists) {
      const binEntries = await fs.readdir(mobileBin, { withFileTypes: true });
      for (const e of binEntries) {
        if (!e.isFile()) continue;
        const abs = path.join(mobileBin, e.name);
        const st = await fs.stat(abs);
        files.push({ abs, rel: `mobile-agent-bin/${e.name}`, size: st.size, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777 });
      }
      dirs.push({ abs: mobileBin, rel: 'mobile-agent-bin/', size: 0, mtime: 0, mode: 0o755 });
    }
  }

  if (kind === 'pc') {
    // 1d. dist/agent-pc/** — compiled pc-agent (tsc -p tsconfig.agent-pc.json).
    // Walks the full tree (agent-pc/ + agent-web/ compiled re-exports).
    const pcAgentExists = await fs.access(PC_AGENT_DIST).then(() => true).catch(() => false);
    if (!pcAgentExists) throw new Error('PC agent bundle missing: run "npm run build:agent-pc" before pushing a PC device');
    await walkDir(PC_AGENT_DIST, 'pc-agent-src', files, dirs, (rel) => {
      if (!/\.(js|json)$/.test(rel)) return false;
      return true;
    });
    dirs.push({ abs: PC_AGENT_DIST, rel: 'pc-agent-src/', size: 0, mtime: 0, mode: 0o755 });
  }

  // 2. node_modules/** — skip per-package .cache dirs (regenerated).
  const nmExists = await fs.access(NODE_MODULES).then(() => true).catch(() => false);
  if (nmExists) {
    const tNm = Date.now();
    console.log(`[agent-push:bundler] walking node_modules at ${NODE_MODULES} ...`);
    await walkDir(NODE_MODULES, 'node_modules', files, dirs, (rel) => {
      if (rel.endsWith('/.cache') || rel.includes('/.cache/')) return false;
      return true;
    }, onProgress);
    console.log(`[agent-push:bundler] node_modules done: ${files.length} files, ${dirs.length} dirs, took=${Date.now() - tNm}ms`);
  } else {
    console.warn(`[agent-push:bundler] node_modules not found at ${NODE_MODULES}; bundle will be missing deps`);
  }

  // 3. browsers/ — chromium-* dirs from the cache matching the *remote* OS+arch.
  // browsers arg is passed in when bundling for an actual remote deploy;
  // when undefined (smoke tests / dev), fall back to the local PLAYWRIGHT_BROWSERS_PATH
  // which is whatever's installed on the host (may be wrong OS, but only matters for prod pushes).
  const browsersSource = browsers
    ? await ensureBrowsersCache(browsers.os, browsers.arch)
    : BROWSERS_DIR;
  const brExists = await fs.access(browsersSource).then(() => true).catch(() => false);
  if (brExists) {
    const tBr = Date.now();
    console.log(`[agent-push:bundler] walking browsers at ${browsersSource}${browsers ? ` (target ${browsers.os}-${browsers.arch})` : ''} ...`);
    const all = await fs.readdir(browsersSource, { withFileTypes: true });
    let included = 0;
    for (const d of all) {
      if (!d.isDirectory()) continue;
      if (!d.name.startsWith('chromium')) continue;
      const abs = path.join(browsersSource, d.name);
      await walkDir(abs, `browsers/${d.name}`, files, dirs, undefined, onProgress);
      included++;
    }
    console.log(`[agent-push:bundler] browsers done: ${included} chromium-* dirs, ${files.length} total files, took=${Date.now() - tBr}ms`);
    if (included === 0) {
      console.warn(`[agent-push:bundler] no chromium-* dirs found under ${browsersSource}; bundle will be missing chromium`);
    }
  } else {
    console.warn(`[agent-push:bundler] browsers source ${browsersSource} not found; bundle will be missing chromium`);
  }

  // 3b. node-runtime/ — official prebuilt node matched to remote OS+arch.
  // Bundler ships node so the remote doesn't need it pre-installed.
  // skipped when nodeRuntime is undefined (e.g. dev runs / smoke tests).
  if (nodeRuntime) {
    const tNode = Date.now();
    console.log(`[agent-push:bundler] preparing node-runtime os=${nodeRuntime.os} arch=${nodeRuntime.arch} ...`);
    const nodeDir = await ensureNodeRuntime(nodeRuntime.os, nodeRuntime.arch, nodeRuntime.version);
    await walkDir(nodeDir, 'node-runtime', files, dirs, undefined, onProgress);
    dirs.push({ abs: nodeDir, rel: 'node-runtime/', size: 0, mtime: 0, mode: 0o755 });
    console.log(`[agent-push:bundler] node-runtime done: ${files.length} total files, took=${Date.now() - tNode}ms`);
  }

  // 3c. adb-runtime/ — Android Platform Tools (adb) for the target OS.
  // Only included for mobile agent pushes. Remote doesn't need pre-installed adb.
  if (adbRuntime) {
    const tAdb = Date.now();
    console.log(`[agent-push:bundler] preparing adb-runtime os=${adbRuntime} ...`);
    const adbDir = await ensureAdbRuntime(adbRuntime);
    await walkDir(adbDir, 'adb-runtime', files, dirs, undefined, onProgress);
    dirs.push({ abs: adbDir, rel: 'adb-runtime/', size: 0, mtime: 0, mode: 0o755 });
    console.log(`[agent-push:bundler] adb-runtime done: ${files.length} total files, took=${Date.now() - tAdb}ms`);
  }

  // 4. DEPLOY_VERSION — generated file, content known upfront.
  const versionStr = `${pkg.version}\n`;
  files.push({
    abs: '(generated)',
    rel: 'DEPLOY_VERSION',
    size: Buffer.byteLength(versionStr, 'utf8'),
    mtime: 0,
    mode: 0o644,
    generated: versionStr,
  });

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  return { files, dirs, version: pkg.version, totalBytes };
}

export interface BundleStream {
  /** Gzipped tar stream — pipe into SFTP or wherever. */
  stream: Readable;
  /** Promise that resolves once enumeration finishes; rejects on error. */
  ready: Promise<{ version: string; fileCount: number; totalBytes: number }>;
}

export interface CreateBundleStreamOptions {
  onEnumerateProgress?: EnumerateProgressFn;
  /**
   * If set, bundle includes a matching official prebuilt node at
   * `node-runtime/` so the remote needs zero pre-installed deps.
   * push.ts infers this from `uname -s` / `uname -m` after SSH connect,
   * and picks `version` from `ldd --version` (modern v24 / legacy v18).
   */
  nodeRuntime?: { os: TargetOs; arch: TargetArch; version: string };
  /**
   * If set, bundle includes chromium-* binaries matching the *remote* OS+arch
   * (downloaded via playwright install with HOST_PLATFORM_OVERRIDE, cached at
   * ~/.cache/auto-test-platform/browsers/<os>-<arch>/).
   * If unset (smoke tests / dev), falls back to local PLAYWRIGHT_BROWSERS_PATH
   * which may be the wrong OS — only meaningful for actual remote deploys.
   */
  browsers?: { os: TargetOs; arch: TargetArch };
  /**
   * If set, bundle includes adb (Android Platform Tools) for the target OS.
   * Only meaningful for mobile agent pushes.
   */
  adbRuntime?: TargetOs;
}

/**
 * Stream a gzipped tar of the agent bundle. The stream's `ready` promise
 * resolves with metadata as soon as enumeration completes — the tar/gzip
 * generation then proceeds asynchronously, driven by the downstream
 * consumer (SFTP upload) through standard stream backpressure.
 *
 * Backpressure design:
 *   - `outer` is a PassThrough (Duplex), so it correctly emits 'drain' when
 *     its internal buffer drains. (A push-mode Readable has no 'drain'
 *     event; the previous implementation deadlocked here.)
 *   - `gz.pipe(outer)` automatically forwards backpressure: when the SFTP
 *     write stream slows, outer pauses gz, which pauses the file read
 *     streams — no chunk is buffered beyond the stream high-water marks.
 *   - `ready` resolves right after enumerate() so push.ts can start the
 *     SFTP upload immediately; upload is what actually drives generation.
 */
export function createBundleStream(kind: AgentBundleKind = 'web', options: CreateBundleStreamOptions = {}): BundleStream {
  const outer = new PassThrough({ highWaterMark: 1024 * 1024 });
  const ready = new Promise<{ version: string; fileCount: number; totalBytes: number }>((resolve, reject) => {
    void (async () => {
      let enumerateResult: { files: BundleFile[]; dirs: BundleFile[]; version: string; totalBytes: number };
      try {
        const t0 = Date.now();
        console.log(`[agent-push:bundler] createBundleStream start kind=${kind}`);
        enumerateResult = await enumerate(kind, options.onEnumerateProgress, options.nodeRuntime, options.browsers, options.adbRuntime);
        const { files, dirs, version, totalBytes } = enumerateResult;
        console.log(`[agent-push:bundler] enumerate complete kind=${kind} files=${files.length} dirs=${dirs.length} size=${(totalBytes / 1024 / 1024).toFixed(1)}MB took=${Date.now() - t0}ms`);
        resolve({ version, fileCount: files.length, totalBytes });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[agent-push:bundler] enumerate FAILED kind=${kind}: ${errMsg}`);
        try { outer.destroy(); } catch { /* ignore */ }
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      try {
        const { files, dirs } = enumerateResult;
        const gz: Gzip = createGzip();
        gz.pipe(outer);
        gz.on('error', (e) => {
          console.error(`[agent-push:bundler] gz error kind=${kind}: ${e.message}`);
          outer.destroy(e);
        });

        const waitForDrain = (): Promise<void> => new Promise<void>((r) => gz.once('drain', r));

        for (const d of dirs) {
          await writeLongLinkIfNeeded(gz, waitForDrain, d.rel);
          if (!gz.write(dirHeader(d.rel, d.mtime))) await waitForDrain();
        }

        const hashes: { rel: string; sha: string }[] = [];
        for (const f of files) {
          await writeLongLinkIfNeeded(gz, waitForDrain, f.rel);
          // 2026-06-27: symlink — typeflag='2',linkname=linkTarget,size=0,
          // 不写文件内容(tar 解压时根据 linkname 重建 symlink)。
          // 不写入 sha256 manifest — 远端 `sha256sum symlink` 默认 follow
          // 算目标内容 hash,跟本地算的对不上(本地无法 readlink 远端文件树)。
          // symlink 完整性由 linkname 字段保证,tar 解压时重建失败会立刻报错。
          if (f.linkTarget !== undefined) {
            if (!gz.write(tarHeader(f.rel, 0, f.mtime, '2', f.mode, f.linkTarget))) await waitForDrain();
            continue;
          }
          if (!gz.write(tarHeader(f.rel, f.size, f.mtime, '0', f.mode))) await waitForDrain();
          const hasher = createHash('sha256');
          if (f.generated !== undefined) {
            const buf = Buffer.from(f.generated, 'utf8');
            hasher.update(buf);
            if (!gz.write(buf)) await waitForDrain();
          } else {
            await new Promise<void>((resolveFile, rejectFile) => {
              const rs = createReadStream(f.abs);
              rs.on('data', (chunk) => {
                hasher.update(chunk as Buffer);
                if (!gz.write(chunk as Buffer)) {
                  rs.pause();
                  gz.once('drain', () => rs.resume());
                }
              });
              rs.on('end', resolveFile);
              rs.on('error', rejectFile);
            });
          }
          const rem = f.size % BLOCK;
          if (rem !== 0) {
            const pad = Buffer.alloc(BLOCK - rem);
            if (!gz.write(pad)) await waitForDrain();
          }
          hashes.push({ rel: f.rel, sha: hasher.digest('hex') });
        }

        // Emit bundle.sha256 last so the manifest reflects everything that
        // came before it.
        const manifest = hashes.map(h => `${h.sha}  ${h.rel}`).join('\n') + '\n';
        const manifestBuf = Buffer.from(manifest, 'utf8');
        if (!gz.write(tarHeader('bundle.sha256', manifestBuf.length, 0))) await waitForDrain();
        if (!gz.write(manifestBuf)) await waitForDrain();
        const mrem = manifestBuf.length % BLOCK;
        if (mrem !== 0) {
          const pad = Buffer.alloc(BLOCK - mrem);
          if (!gz.write(pad)) await waitForDrain();
        }

        if (!gz.write(ZERO_BLOCK)) await waitForDrain();
        if (!gz.write(ZERO_BLOCK)) await waitForDrain();
        gz.end();
        console.log(`[agent-push:bundler] gz.end() called kind=${kind} files=${files.length} dirs=${dirs.length}`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[agent-push:bundler] stream generation FAILED kind=${kind}: ${errMsg}`);
        try { outer.destroy(e instanceof Error ? e : new Error(String(e))); } catch { /* ignore */ }
      }
    })();
  });

  return { stream: outer, ready };
}
