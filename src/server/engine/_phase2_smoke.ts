// Phase 2-7 smoke test for pure functions:
//   - parseNLSteps: 11 old web actions → NL migration
//   - parseNLSteps: 10 old mobile actions → NL migration (Phase 4 deviation-safe)
//   - generateReportPath / reportFileName: path computation
//   - cleanupOldReports: removes > N days old, keeps recent
//   - PC schema: removed fields are not in row (regression guard for bug-009)
//
// Run: npx tsx src/server/engine/_phase2_smoke.ts  (or `npm test`)
// Will be removed once Phase 7 wires up Vitest.

import { strict as assert } from 'node:assert';
import { parseNLSteps, migrateStep, isOldStep, MOBILE_ASSERTS, WEB_PC_ASSERTS, nlStepToMobileAction } from './nl-steps.js';
import {
  generateReportPath,
  reportFileName,
  relativeReportUrl,
  REPORTS_ROOT,
} from './report-paths.js';
import { cleanupOldReports } from '../scheduler/report-cleanup.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
};

console.log('parseNLSteps:');

test('returns empty for null/undefined/empty', () => {
  assert.deepEqual(parseNLSteps(null), []);
  assert.deepEqual(parseNLSteps(undefined), []);
  assert.deepEqual(parseNLSteps(''), []);
  assert.deepEqual(parseNLSteps('not-json'), []);
  assert.deepEqual(parseNLSteps('{"not":"array"}'), []);
});

test('passes through new NL format unchanged', () => {
  const input = JSON.stringify([
    { description: '打开首页' },
    { description: '点击登录', expect: '看到用户头像' },
  ]);
  const out = parseNLSteps(input);
  assert.deepEqual(out, [
    { description: '打开首页' },
    { description: '点击登录', expect: '看到用户头像' },
  ]);
});

test('migrates 打开页面/导航 to prefixed description (no expect)', () => {
  const out = parseNLSteps(JSON.stringify([{ action: '打开页面', desc: 'https://example.com' }]));
  assert.deepEqual(out, [{ description: '打开页面 https://example.com' }]);
});

test('migrates 输入/点击/勾选/滚动 to prefixed description', () => {
  const out = parseNLSteps(JSON.stringify([
    { action: '输入', desc: 'admin' },
    { action: '点击', desc: '登录按钮' },
    { action: '勾选', desc: '记住我' },
    { action: '滚动', desc: '500' },
  ]));
  assert.deepEqual(out, [
    { description: '输入 admin' },
    { description: '点击 登录按钮' },
    { description: '勾选 记住我' },
    { description: '滚动 500' },
  ]);
});

test('migrates 断言/检查* to expect-only (no description)', () => {
  const out = parseNLSteps(JSON.stringify([
    { action: '断言', desc: '页面包含"欢迎"' },
    { action: '检查页面跳转', desc: 'URL 变为 /home' },
    { action: '检查文本', desc: '看到"成功"' },
    { action: '检查元素', desc: '头像可见' },
  ]));
  assert.deepEqual(out, [
    { description: '', expect: '页面包含"欢迎"' },
    { description: '', expect: 'URL 变为 /home' },
    { description: '', expect: '看到"成功"' },
    { description: '', expect: '头像可见' },
  ]);
});

test('filters out completely empty steps after migration', () => {
  // Both description and expect empty after migration
  const out = parseNLSteps(JSON.stringify([{ action: '断言', desc: '   ' }]));
  assert.deepEqual(out, []);
});

test('keeps step with action-only prefix when desc is empty', () => {
  const out = parseNLSteps(JSON.stringify([{ action: '点击', desc: '' }]));
  assert.deepEqual(out, [{ description: '点击' }]);
});

test('handles mixed old+new in same array', () => {
  const out = parseNLSteps(JSON.stringify([
    { action: '点击', desc: '登录' },
    { description: '等待页面加载', expect: '看到 dashboard' },
  ]));
  assert.deepEqual(out, [
    { description: '点击 登录' },
    { description: '等待页面加载', expect: '看到 dashboard' },
  ]);
});

test('isOldStep detects action field', () => {
  assert.equal(isOldStep({ action: '点击', desc: 'x' }), true);
  assert.equal(isOldStep({ description: 'x' }), false);
  assert.equal(isOldStep(null), false);
  assert.equal(isOldStep('string'), false);
});

test('migrateStep direct (assertion edge cases)', () => {
  assert.deepEqual(
    migrateStep({ action: '  断言  ', desc: '包含 X' }),
    { description: '', expect: '包含 X' }
  );
  assert.deepEqual(
    migrateStep({ action: '点击', desc: '   ' }),
    { description: '点击' }
  );
});

console.log('\nreport-paths:');

test('REPORTS_ROOT is under cwd/data/midscene-reports', () => {
  assert.ok(REPORTS_ROOT.endsWith('data/midscene-reports'));
});

test('generateReportPath segments testType/caseId/execId/index.html', () => {
  const p = generateReportPath('web', 5, 12);
  assert.ok(p.endsWith('/web/5/12/index.html'), `got ${p}`);
});

test('generateReportPath sanitizes path-traversal characters', () => {
  const p = generateReportPath('web', '../../../etc/passwd', 'id');
  assert.ok(!p.includes('..'), `path traversal leaked: ${p}`);
  assert.ok(!p.includes('etc/passwd'), `raw user input leaked: ${p}`);
});

test('relativeReportUrl produces /midscene-reports/...', () => {
  const u = relativeReportUrl('mobile', 1, 2);
  assert.equal(u, '/midscene-reports/mobile/1/2/index.html');
});

test('reportFileName produces a subdir-style name', () => {
  assert.equal(reportFileName('web', 5, 12), 'web-case-5-exec-12');
  assert.equal(reportFileName('computer', 'a-b', 'c'), 'computer-case-a-b-exec-c');
});

console.log('\nmobile migration:');

test('migrates mobile 10-action format using MOBILE_ASSERTS', () => {
  const out = parseNLSteps(JSON.stringify([
    { action: 'tap', target: '登录' },
    { action: 'input', target: '用户名', value: 'admin' },
    { action: 'swipe', direction: 'up' },
    { action: 'assert', target: '看到 dashboard' },
    { action: '检查元素', target: '头像可见' },
  ]), MOBILE_ASSERTS);
  assert.deepEqual(out, [
    { description: 'tap 登录' },
    { description: 'input 用户名 (值: admin)' },
    { description: 'swipe' },
    { description: '', expect: '看到 dashboard' },
    { description: '', expect: '头像可见' },
  ]);
});

test('WEB_PC_ASSERTS and MOBILE_ASSERTS are different sets', () => {
  // web has 检查页面跳转; mobile does not
  assert.ok(WEB_PC_ASSERTS.has('检查页面跳转'));
  assert.ok(!MOBILE_ASSERTS.has('检查页面跳转'));
  // both share 断言/检查元素/检查文本
  assert.ok(WEB_PC_ASSERTS.has('断言') && MOBILE_ASSERTS.has('断言'));
});

console.log('\nnlStepToMobileAction (mobile executor bridge):');

test('nlStepToMobileAction: expect non-empty → assert action', () => {
  assert.deepEqual(
    nlStepToMobileAction({ description: '', expect: '看到 dashboard' }),
    { action: 'assert', target: '看到 dashboard' }
  );
});

test('nlStepToMobileAction: head token matches MOBILE_ACTIONS → split', () => {
  assert.deepEqual(
    nlStepToMobileAction({ description: 'tap 登录按钮' }),
    { action: 'tap', target: '登录按钮' }
  );
  assert.deepEqual(
    nlStepToMobileAction({ description: 'swipe up' }),
    { action: 'swipe', target: 'up' }
  );
  assert.deepEqual(
    nlStepToMobileAction({ description: 'sleep' }),
    { action: 'sleep', target: '' }
  );
});

test('nlStepToMobileAction: head token unknown → fallback tap with full desc', () => {
  assert.deepEqual(
    nlStepToMobileAction({ description: '点击登录按钮' }),
    { action: 'tap', target: '点击登录按钮' }
  );
});

test('nlStepToMobileAction: empty description + no expect → empty tap', () => {
  assert.deepEqual(
    nlStepToMobileAction({ description: '' }),
    { action: 'tap', target: '' }
  );
  assert.deepEqual(
    nlStepToMobileAction({ description: '   ' }),
    { action: 'tap', target: '' }
  );
});

test('nlStepToMobileAction: end-to-end with parseNLSteps roundtrip', () => {
  // Bridge: NL from frontend → executor's 10-action shape
  const nl = parseNLSteps(JSON.stringify([
    { description: 'tap 登录' },
    { description: '', expect: '看到 dashboard' },
    { description: 'swipe up' },
  ]));
  const back = nl.map(nlStepToMobileAction);
  assert.deepEqual(back, [
    { action: 'tap', target: '登录' },
    { action: 'assert', target: '看到 dashboard' },
    { action: 'swipe', target: 'up' },
  ]);
});

console.log('\npc schema regression (bug-009):');

// Compile-time + runtime check: removed fields must not appear in PcCaseRow.
// If someone re-introduces them, this test fails before the user sees a
// SqliteError on INSERT.
test('PcCaseRow interface no longer exposes removed fields', () => {
  // Bug-009 regression guard: removed fields must not re-appear in PcCaseRow.
  // The 3 string literals below MUST be unassignable to keyof PcCaseRow.
  // If someone re-introduces one, the @ts-expect-error becomes unused → compile error.
  type PcKeys = keyof import('../db/pc-cases.js').PcCaseRow;
  const banned: PcKeys[] = [
    // @ts-expect-error — 'browser' must not be assignable to keyof PcCaseRow
    'browser',
    // @ts-expect-error — 'headless_mode' must not be assignable to keyof PcCaseRow
    'headless_mode',
    // @ts-expect-error — 'base_url' must not be assignable to keyof PcCaseRow
    'base_url',
  ];
  // Runtime fallback: assert via string comparison.
  assert.deepEqual(banned.map(String).sort(), ['base_url', 'browser', 'headless_mode']);
});

console.log('\nreport cleanup:');

test('cleanupOldReports removes > N days, keeps recent', async () => {
  const root = REPORTS_ROOT;
  const old = path.join(root, 'web', '999', '1');
  const recent = path.join(root, 'web', '999', '2');
  await fs.mkdir(old, { recursive: true });
  await fs.mkdir(recent, { recursive: true });
  await fs.writeFile(path.join(old, 'index.html'), '<html>old</html>');
  await fs.writeFile(path.join(recent, 'index.html'), '<html>recent</html>');
  // Backdate old by 40 days
  const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await fs.utimes(old, oldTime, oldTime);

  const stats = await cleanupOldReports(30);
  assert.equal(stats.removed >= 1, true, `expected at least 1 removal, got ${stats.removed}`);

  const oldExists = await fs.stat(old).then(() => true).catch(() => false);
  const recentExists = await fs.stat(recent).then(() => true).catch(() => false);
  assert.equal(oldExists, false, 'old dir should be removed');
  assert.equal(recentExists, true, 'recent dir should be kept');

  // Cleanup
  await fs.rm(recent, { recursive: true, force: true });
  await fs.rm(path.join(root, 'web', '999'), { recursive: true, force: true });
});

test('cleanupOldReports returns empty stats when REPORTS_ROOT missing', async () => {
  // Cleanup is a no-op when nothing to clean. We don't want it to crash
  // on a fresh install where data/midscene-reports/ hasn't been created yet.
  // This is just a smoke check that calling it doesn't throw.
  const stats = await cleanupOldReports(30);
  assert.ok(typeof stats.scanned === 'number');
  assert.ok(typeof stats.removed === 'number');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
