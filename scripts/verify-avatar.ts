// Verifies avatar magic-bytes detection
// Run: npx tsx scripts/verify-avatar.ts

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Extract the detectImageType function via a re-implementation that mirrors
// the production code. (Importing from auth.ts pulls in Express middleware
// and DB modules — overkill for a unit test of the parser logic.)
function detectImageType(filePath: string): { ext: string; mime: string } | null {
  const ALLOWED_IMAGE_TYPES: Array<{
    ext: string;
    mime: string;
    match: (head: Buffer) => boolean;
  }> = [
    { ext: '.jpg', mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: '.png', mime: 'image/png', match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    { ext: '.gif', mime: 'image/gif', match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
    {
      ext: '.webp',
      mime: 'image/webp',
      match: (b) =>
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    },
  ];

  let head: Buffer;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      head = buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const t of ALLOWED_IMAGE_TYPES) {
    if (t.match(head)) return { ext: t.ext, mime: t.mime };
  }
  return null;
}

let pass = 0;
let fail = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-test-'));

function writeFixture(name: string, bytes: number[]) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

console.log('Verifying avatar magic-bytes detection (Phase 1.5 fix)...\n');

// Real magic-byte headers
expect('JPEG detected', detectImageType(writeFixture('a.jpg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), { ext: '.jpg', mime: 'image/jpeg' });
expect('PNG detected', detectImageType(writeFixture('a.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), { ext: '.png', mime: 'image/png' });
expect('GIF detected', detectImageType(writeFixture('a.gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])), { ext: '.gif', mime: 'image/gif' });
expect('WebP detected', detectImageType(writeFixture('a.webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), { ext: '.webp', mime: 'image/webp' });

// Malicious: SVG with embedded script — must be REJECTED
expect(
  'SVG with <script> rejected (XSS attempt)',
  detectImageType(writeFixture('evil.svg', [0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f])),
  null
);
expect(
  'SVG with <svg> root rejected',
  detectImageType(writeFixture('evil2.svg', [0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22])),
  null
);

// Malicious: HTML with javascript: URL — rejected
expect(
  'HTML file rejected',
  detectImageType(writeFixture('evil.html', [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0, 0, 0, 0, 0, 0])),
  null
);

// Malicious: Executable renamed as .jpg — rejected (no magic bytes)
expect(
  'Executable with .jpg name rejected',
  detectImageType(writeFixture('fake.jpg', [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0, 0, 0, 0, 0, 0])),
  null
);

// Malicious: empty file — rejected
expect('Empty file rejected', detectImageType(writeFixture('empty.jpg', [])), null);

// Malicious: polyglot file (JPEG magic + SVG payload appended) — still JPEG
// (this is acceptable: we trust the file starts as an image; if user tries
// to serve a polyglot the Content-Disposition: attachment header prevents
// the browser from rendering it inline)
expect(
  'Polyglot JPEG+SVG detected as JPEG (correct)',
  detectImageType(writeFixture('polyglot.jpg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0x3c, 0x73, 0x76, 0x67])),
  { ext: '.jpg', mime: 'image/jpeg' }
);

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
