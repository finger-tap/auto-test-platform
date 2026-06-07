// 2026-06-06: agent-side report packaging.
//
// After a Midscene case finishes, the central server calls
// `GET /sessions/:id/report` to fetch the report. The agent packages
// the session's reportTempDir as a gzipped tarball and streams it back.
//
// We use plain Node `node:zlib` + manual tar assembly to avoid pulling
// in a new dependency. The tar format is simple (ustar) and Midscene
// reports are small (<10MB typically), so the cost is negligible.
//
// Format: 512-byte tar header per file, file data padded to 512-byte
// boundary, two zero blocks at the end. Whole thing gzipped.

import { promises as fs, createReadStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import path from 'node:path';

const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK);

function tarHeader(name: string, size: number, mtime: number, typeFlag = '0'): Buffer {
  const buf = Buffer.alloc(BLOCK);
  // name (100 bytes)
  buf.write(name.slice(0, 99), 0, 100, 'utf8');
  // mode (8 bytes, octal string)
  buf.write('0000644', 100, 7, 'utf8');
  buf.write('\0', 107, 1, 'utf8');
  // uid (8 bytes)
  buf.write('0000000', 108, 7, 'utf8');
  buf.write('\0', 115, 1, 'utf8');
  // gid (8 bytes)
  buf.write('0000000', 116, 7, 'utf8');
  buf.write('\0', 123, 1, 'utf8');
  // size (12 bytes, octal)
  buf.write(size.toString(8).padStart(11, '0'), 124, 11, 'utf8');
  buf.write('\0', 135, 1, 'utf8');
  // mtime (12 bytes, octal)
  const mt = Math.floor(mtime);
  buf.write(mt.toString(8).padStart(11, '0'), 136, 11, 'utf8');
  buf.write('\0', 147, 1, 'utf8');
  // checksum placeholder (8 bytes) — fill with spaces first, then sum
  for (let i = 148; i < 156; i++) buf.write(' ', i, 1, 'utf8');
  buf.write(typeFlag, 156, 1, 'utf8');
  // Compute checksum
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

/**
 * Build a gzipped tar of the given directory, return as a single Buffer.
 * Suitable for short reports; for very large reports (hundreds of MB) a
 * streaming variant would be preferable. Midscene reports are typically
 * <10MB even with video, so this is fine.
 */
export async function tarGzDir(srcDir: string): Promise<Buffer> {
  const files = await walk(srcDir);
  const chunks: Buffer[] = [];
  for (const f of files) {
    const header = tarHeader(f.rel, f.size, f.mtime);
    chunks.push(header);
    const data = await fs.readFile(f.abs);
    chunks.push(data);
    // Pad to BLOCK boundary
    const rem = f.size % BLOCK;
    if (rem !== 0) chunks.push(Buffer.alloc(BLOCK - rem));
  }
  // Two zero blocks mark end of tar
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

/**
 * Stream-based variant: returns a Node Readable that emits the gzipped
 * tar. Use this for large reports or when piping directly to the HTTP
 * response. Not currently used — kept here for future optimization.
 */
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
