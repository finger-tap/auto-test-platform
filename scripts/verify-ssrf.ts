// Verifies SSRF protections in parseFromUrl
// Run: npx tsx scripts/verify-ssrf.ts

import { parseFromUrl } from '../src/server/openapi/parser.js';

let pass = 0;
let fail = 0;

async function expectThrow(label: string, url: string, msgPattern: RegExp) {
  try {
    await parseFromUrl(url);
    fail++;
    console.error(`  ✗ ${label} — did not throw`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msgPattern.test(msg)) {
      pass++;
      console.log(`  ✓ ${label}`);
    } else {
      fail++;
      console.error(`  ✗ ${label} — wrong error: ${msg}`);
    }
  }
}

async function run() {
  console.log('Verifying SSRF protections (Phase 1.3 fix)...\n');

  // Protocol allowlist
  await expectThrow(
    'file:// protocol rejected',
    'file:///etc/passwd',
    /Only http and https|Invalid URL|getaddrinfo|ENOTFOUND|protocol/i
  );
  await expectThrow(
    'javascript: protocol rejected',
    'javascript:alert(1)',
    /Only http and https|Invalid URL/i
  );
  await expectThrow(
    'gopher: protocol rejected',
    'gopher://localhost:1234/_test',
    /Only http and https|Invalid URL/i
  );
  await expectThrow(
    'ftp: protocol rejected',
    'ftp://example.com/test',
    /Only http and https|Invalid URL/i
  );

  // Blocked IPs (localhost / loopback)
  await expectThrow(
    'localhost hostname rejected',
    'http://localhost/api.json',
    /blocked address|ENOTFOUND|getaddrinfo|Cannot resolve/i
  );
  await expectThrow(
    '127.0.0.1 loopback rejected',
    'http://127.0.0.1/api.json',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );
  await expectThrow(
    '0.0.0.0 rejected',
    'http://0.0.0.0/api.json',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );

  // Private ranges
  await expectThrow(
    '10.x.x.x private rejected',
    'http://10.0.0.1/api.json',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );
  await expectThrow(
    '192.168.x.x private rejected',
    'http://192.168.1.1/api.json',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );
  await expectThrow(
    '172.16-31.x.x private rejected',
    'http://172.20.5.1/api.json',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );

  // Link-local
  await expectThrow(
    '169.254.x.x link-local rejected',
    'http://169.254.169.254/latest/meta-data/',
    /blocked address|ENOTFOUND|getaddrinfo/i
  );

  // Invalid URL
  await expectThrow(
    'Invalid URL rejected',
    'not a url',
    /Invalid URL|getaddrinfo|ENOTFOUND/i
  );
}

run().then(() => {
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
});
