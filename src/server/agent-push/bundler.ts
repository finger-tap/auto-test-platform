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
import { Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root = src/server/agent-push/bundler.ts → 3 levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const AGENT_SRC = path.join(PROJECT_ROOT, 'src', 'agent-web');
// 2026-06-08: mobile-agent 跟 web-agent 平级,同一份 bundle 也带上
const MOBILE_AGENT_SRC = path.join(PROJECT_ROOT, 'src', 'agent-mobile');
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

function tarHeader(name: string, size: number, mtime: number, typeFlag = '0'): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name.slice(0, 99), 0, 100, 'utf8');
  buf.write('0000644', 100, 7, 'utf8'); buf.write('\0', 107, 1, 'utf8');
  buf.write('0000000', 108, 7, 'utf8'); buf.write('\0', 115, 1, 'utf8');
  buf.write('0000000', 116, 7, 'utf8'); buf.write('\0', 123, 1, 'utf8');
  buf.write(size.toString(8).padStart(11, '0'), 124, 11, 'utf8'); buf.write('\0', 135, 1, 'utf8');
  buf.write(Math.floor(mtime).toString(8).padStart(11, '0'), 136, 11, 'utf8'); buf.write('\0', 147, 1, 'utf8');
  for (let i = 148; i < 156; i++) buf.write(' ', i, 1, 'utf8');
  buf.write(typeFlag, 156, 1, 'utf8');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'utf8');
  buf.write('\0 ', 154, 2, 'utf8');
  return buf;
}

function dirHeader(name: string, mtime: number): Buffer {
  return tarHeader(name.endsWith('/') ? name : name + '/', 0, mtime, '5');
}

interface BundleFile {
  abs: string;
  rel: string;
  size: number;
  mtime: number;
  /** For generated files (DEPLOY_VERSION), the content goes here. */
  generated?: string;
}

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

async function walkDir(
  abs: string,
  rel: string,
  files: BundleFile[],
  dirs: BundleFile[],
  shouldInclude?: (rel: string) => boolean
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
      dirs.push({ abs: childAbs, rel: childRel + '/', size: 0, mtime: 0 });
      await walkDir(childAbs, childRel, files, dirs, shouldInclude);
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(childAbs);
        files.push({ abs: childAbs, rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
      } catch {
        // race: file disappeared mid-walk, skip
      }
    }
  }
}

/**
 * Enumerate the files we want to include. Doesn't read contents — we
 * stream each one inside createBundleStream so the tar doesn't need to
 * hold the whole bundle in memory.
 */
async function enumerate(): Promise<{ files: BundleFile[]; dirs: BundleFile[]; version: string; totalBytes: number }> {
  const pkgRaw = await fs.readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw) as { version: string };

  const files: BundleFile[] = [];
  const dirs: BundleFile[] = [];

  // 1. src/agent-web/** — only source files (ts/json/md), no test fixtures.
  const agentEntries = await fs.readdir(AGENT_SRC, { withFileTypes: true });
  for (const e of agentEntries) {
    if (!e.isFile()) continue;
    if (!/\.(ts|json|md)$/.test(e.name)) continue;
    const abs = path.join(AGENT_SRC, e.name);
    const st = await fs.stat(abs);
    files.push({ abs, rel: `agent-src/${e.name}`, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
  }
  dirs.push({ abs: AGENT_SRC, rel: 'agent-src/', size: 0, mtime: 0 });

  // 1b. src/agent-mobile/** — same shape as above, separate dir inside bundle.
  // systemd unit ExecStart 指向 mobile-agent/index.js,所以这一段必须独立。
  const mobileExists = await fs.access(MOBILE_AGENT_SRC).then(() => true).catch(() => false);
  if (mobileExists) {
    const mobEntries = await fs.readdir(MOBILE_AGENT_SRC, { withFileTypes: true });
    for (const e of mobEntries) {
      if (!e.isFile()) continue;
      if (!/\.(ts|json|md)$/.test(e.name)) continue;
      const abs = path.join(MOBILE_AGENT_SRC, e.name);
      const st = await fs.stat(abs);
      files.push({ abs, rel: `mobile-agent-src/${e.name}`, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
    }
    // 1c. src/agent-mobile/bin/scrcpy-server — mobile-agent 启动 scrcpy 用的 Java jar
    // (从 midscene android-playground 同步过来),tar 里走 mobile-agent-bin/scrcpy-server
    // 一并存到远端,启动时通过 CLASSPATH 加载。
    const mobileBin = path.join(MOBILE_AGENT_SRC, 'bin');
    const mobileBinExists = await fs.access(mobileBin).then(() => true).catch(() => false);
    if (mobileBinExists) {
      const binEntries = await fs.readdir(mobileBin, { withFileTypes: true });
      for (const e of binEntries) {
        if (!e.isFile()) continue;
        const abs = path.join(mobileBin, e.name);
        const st = await fs.stat(abs);
        files.push({ abs, rel: `mobile-agent-bin/${e.name}`, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
      }
      dirs.push({ abs: mobileBin, rel: 'mobile-agent-bin/', size: 0, mtime: 0 });
    }
    dirs.push({ abs: MOBILE_AGENT_SRC, rel: 'mobile-agent-src/', size: 0, mtime: 0 });
  }

  // 1d. dist/agent-pc/** — compiled pc-agent (tsc -p tsconfig.agent-pc.json).
  // Walks the full tree (agent-pc/ + agent-web/ compiled re-exports).
  // Must run `npm run build:agent-pc` before bundling.
  const pcAgentExists = await fs.access(PC_AGENT_DIST).then(() => true).catch(() => false);
  if (pcAgentExists) {
    await walkDir(PC_AGENT_DIST, 'pc-agent-src', files, dirs, (rel) => {
      if (!/\.(js|json)$/.test(rel)) return false;
      return true;
    });
    dirs.push({ abs: PC_AGENT_DIST, rel: 'pc-agent-src/', size: 0, mtime: 0 });
  } else {
    console.warn('[agent-push:bundler] dist/agent-pc not found; run "npm run build:agent-pc" first');
  }

  // 2. node_modules/** — skip per-package .cache dirs (regenerated).
  const nmExists = await fs.access(NODE_MODULES).then(() => true).catch(() => false);
  if (nmExists) {
    await walkDir(NODE_MODULES, 'node_modules', files, dirs, (rel) => {
      if (rel.endsWith('/.cache') || rel.includes('/.cache/')) return false;
      return true;
    });
  } else {
    console.warn(`[agent-push:bundler] node_modules not found at ${NODE_MODULES}; bundle will be missing deps`);
  }

  // 3. browsers/ — only chromium-* directories.
  const brExists = await fs.access(BROWSERS_DIR).then(() => true).catch(() => false);
  if (brExists) {
    const all = await fs.readdir(BROWSERS_DIR, { withFileTypes: true });
    for (const d of all) {
      if (!d.isDirectory()) continue;
      if (!d.name.startsWith('chromium')) continue;
      const abs = path.join(BROWSERS_DIR, d.name);
      await walkDir(abs, `browsers/${d.name}`, files, dirs);
    }
  } else {
    console.warn(`[agent-push:bundler] PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_DIR} not found; bundle will be missing chromium`);
  }

  // 4. DEPLOY_VERSION — generated file, content known upfront.
  const versionStr = `${pkg.version}\n`;
  files.push({
    abs: '(generated)',
    rel: 'DEPLOY_VERSION',
    size: Buffer.byteLength(versionStr, 'utf8'),
    mtime: 0,
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

/**
 * Stream a gzipped tar of the agent bundle. The stream's `ready` promise
 * resolves with metadata once enumeration completes.
 */
export function createBundleStream(): BundleStream {
  const outer = new Readable({ read() {} });
  const ready = new Promise<{ version: string; fileCount: number; totalBytes: number }>((resolve, reject) => {
    void (async () => {
      try {
        const t0 = Date.now();
        outer.push(`[agent-push:bundler] enumerating... `);
        const { files, dirs, version, totalBytes } = await enumerate();
        outer.push(`files=${files.length} dirs=${dirs.length} size=${(totalBytes / 1024 / 1024).toFixed(1)}MB enumerate=${Date.now() - t0}ms\n`);
        const gz: Gzip = createGzip();
        gz.on('data', (chunk: Buffer) => { if (!outer.push(chunk)) gz.pause(); });
        gz.on('end', () => outer.push(null));
        gz.on('drain', () => gz.resume());
        gz.on('error', (e) => outer.destroy(e));

        for (const d of dirs) gz.write(dirHeader(d.rel, d.mtime));

        const hashes: { rel: string; sha: string }[] = [];
        for (const f of files) {
          gz.write(tarHeader(f.rel, f.size, f.mtime));
          const hasher = createHash('sha256');
          if (f.generated !== undefined) {
            const buf = Buffer.from(f.generated, 'utf8');
            hasher.update(buf);
            gz.write(buf);
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
          if (rem !== 0) gz.write(Buffer.alloc(BLOCK - rem));
          hashes.push({ rel: f.rel, sha: hasher.digest('hex') });
        }

        // Emit bundle.sha256 last so the manifest reflects everything that
        // came before it.
        const manifest = hashes.map(h => `${h.sha}  ${h.rel}`).join('\n') + '\n';
        const manifestBuf = Buffer.from(manifest, 'utf8');
        gz.write(tarHeader('bundle.sha256', manifestBuf.length, 0));
        gz.write(manifestBuf);
        const rem = manifestBuf.length % BLOCK;
        if (rem !== 0) gz.write(Buffer.alloc(BLOCK - rem));

        gz.write(ZERO_BLOCK);
        gz.write(ZERO_BLOCK);
        gz.end();

        resolve({ version, fileCount: files.length, totalBytes });
      } catch (e) {
        outer.destroy(e instanceof Error ? e : new Error(String(e)));
        reject(e);
      }
    })();
  });

  return { stream: outer, ready };
}
