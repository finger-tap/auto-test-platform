// 2026-07-01: pc-agent report packaging — self-contained. After a Midscene
// case finishes, the central server calls GET /sessions/:id/report and
// this packages the session's reportTempDir as a gzipped tarball and
// streams it back. Same format (ustar tarball → gzip → Buffer) as the
// other agents, but kept in-tree so pc-agent's bundle has zero dependency
// on agent-web source.

import { promises as fs, createReadStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import path from 'node:path';

const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK);

function tarHeader(name: string, size: number, mtime: number, typeFlag = '0'): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name.slice(0, 99), 0, 100, 'utf8');
  buf.write('0000644', 100, 7, 'utf8');
  buf.write('\0', 107, 1, 'utf8');
  buf.write('0000000', 108, 7, 'utf8');
  buf.write('\0', 115, 1, 'utf8');
  buf.write('0000000', 116, 7, 'utf8');
  buf.write('\0', 123, 1, 'utf8');
  buf.write(size.toString(8).padStart(11, '0'), 124, 11, 'utf8');
  buf.write('\0', 135, 1, 'utf8');
  const mt = Math.max(315532800, Math.floor(mtime));
  buf.write(mt.toString(8).padStart(11, '0'), 136, 11, 'utf8');
  buf.write('\0', 147, 1, 'utf8');
  for (let i = 148; i < 156; i++) buf.write(' ', i, 1, 'utf8');
  buf.write(typeFlag, 156, 1, 'utf8');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'utf8');
  buf.write('\0 ', 154, 2, 'utf8');
  return buf;
}

async function walk(dir: string, base = ''): Promise<{ abs: string; rel: string; size: number; mtime: number }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: { abs: string; rel: string; size: number; mtime: number }[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walk(abs, rel)));
    } else if (e.isFile()) {
      const st = await fs.stat(abs);
      out.push({ abs, rel, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  }
  return out;
}

export async function tarGzDir(srcDir: string): Promise<Buffer> {
  const files = await walk(srcDir);
  const chunks: Buffer[] = [];
  for (const f of files) {
    const header = tarHeader(f.rel, f.size, f.mtime);
    chunks.push(header);
    const data = await fs.readFile(f.abs);
    chunks.push(data);
    const rem = f.size % BLOCK;
    if (rem !== 0) chunks.push(Buffer.alloc(BLOCK - rem));
  }
  chunks.push(ZERO_BLOCK);
  chunks.push(ZERO_BLOCK);

  const tar = Buffer.concat(chunks);
  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGzip();
    const out: Buffer[] = [];
    gz.on('data', (c: Buffer) => out.push(c));
    gz.on('end', () => resolve(Buffer.concat(out)));
    gz.on('error', reject);
    gz.end(tar);
  });
}

export function tarGzDirStream(srcDir: string): NodeJS.ReadableStream {
  const gz = createGzip();
  void (async () => {
    try {
      const files = await walk(srcDir);
      for (const f of files) {
        if (!gz.write(tarHeader(f.rel, f.size, f.mtime))) {
          await new Promise<void>((r) => gz.once('drain', () => r()));
        }
        await new Promise<void>((resolve, reject) => {
          const rs = createReadStream(f.abs);
          rs.on('data', (c) => { if (!gz.write(c as Buffer)) rs.pause(); });
          rs.on('end', () => {
            const rem = f.size % BLOCK;
            if (rem !== 0) gz.write(Buffer.alloc(BLOCK - rem));
            resolve();
          });
          rs.on('error', reject);
          rs.on('drain', () => rs.resume());
        });
      }
      gz.write(ZERO_BLOCK);
      gz.write(ZERO_BLOCK);
      gz.end();
    } catch (e) {
      gz.destroy(e as Error);
    }
  })();
  return gz;
}