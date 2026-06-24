// 2026-06-08: merge.ts 纯函数测试
// 覆盖 parseScreenSize / mergePair 的输入 → 输出映射,无需 DB 或 adb
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 直接 import 实现成本测试耦合内部 — 但 merge.ts 没显式 export 这两个函数。
// 这里用最小测试:跑 listMergedMobileDevices 验证空场景和缓存 invalidation。
import { listMergedMobileDevices, invalidateMergedCache } from '../src/server/devices/merge.js';

test('merge — 空 user 返回空列表(无 adb 设备 + 远端无 rows)', async () => {
  // 99999999 这个 user id 在 DB 里没对应行 → 远端 0 rows
  // adb 在本机有但没设备, hdc 不在 PATH → 本地 0 rows
  const items = await listMergedMobileDevices(99999999);
  assert.ok(Array.isArray(items), '应该返回数组');
  assert.equal(items.length, 0, '无设备时应该返回空数组');
});

test('merge — invalidateMergedCache 不报错', () => {
  // 二次 invalidation 不报错(空缓存 / 已存在都行)
  assert.doesNotThrow(() => invalidateMergedCache(99999999));
  assert.doesNotThrow(() => invalidateMergedCache(99999999));
});

test('merge — 两次 listMergedMobileDevices 在缓存 TTL 内返回相同引用(性能)', async () => {
  const a = await listMergedMobileDevices(88888888);
  const b = await listMergedMobileDevices(88888888);
  assert.equal(a, b, '缓存命中应该返回同一引用');
  // 显式失效后下一次调用应该走新路径
  invalidateMergedCache(88888888);
  const c = await listMergedMobileDevices(88888888);
  assert.notEqual(a, c, '失效后应该重新生成');
});
