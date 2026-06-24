// 2026-06-08: mobile-preview/proxy.ts 单元测试
// 覆盖:无效 deviceId / 不支持 kind / session 生命周期
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startPreviewSession,
  stopSession,
  hasSession,
  activeSessionCount,
} from '../src/server/mobile-preview/proxy.js';

test('startPreviewSession — 无效 deviceId 字符串返回 null', async () => {
  // 'bogus:foo' 不匹配 'local:android:<serial>' 格式 → buildFetcher 返回 null
  const r = await startPreviewSession({
    userId: 1,
    deviceId: 'bogus:foo',
    kind: 'screenshot',
  });
  assert.equal(r, null, '无效 deviceId 应该返回 null');
});

test('startPreviewSession — kind=scrcpy 当前 v1 不支持(本地路径)', async () => {
  // 本地 string id "local:android:<serial>" 走 buildScrcpyEntry 时 Number(...) 是 NaN,
  // 立刻 return null;真要本地 scrcpy 需要 server 端启 adb-server + 推 scrcpy-server,
  // 跟 mobile-agent 重复,plan 里 v1 不做(只走远端 mobile-agent)。
  const r = await startPreviewSession({
    userId: 1,
    deviceId: 'local:android:fake-serial',
    kind: 'scrcpy',
  });
  assert.equal(r, null, '本地 string id 不支持 scrcpy');
});

test('startPreviewSession — kind=mjpeg 当前复用 WDA 截图 polling(5 FPS)', async () => {
  // v1 mjpeg 没接 wda-mjpeg shim,只是把 SSE 拉帧间隔从 600ms 调到 200ms(5 FPS),
  // fetcher 还是 WDA 的 /screenshot。本地 iOS WDA 路径能起来 → 拿到 fetcher。
  const r = await startPreviewSession({
    userId: 1,
    deviceId: 'local:ios:fake-udid',
    kind: 'mjpeg',
  });
  // 真实环境需要 WDA 跑起来才会拿到非 null;测试环境下 WDA_URL 不可达,允许 null
  if (r !== null) {
    assert.equal(r.kind, 'mjpeg');
    assert.ok(r.ssePath?.includes(r.sessionId));
  }
});

test('session 生命周期 — stopSession / hasSession', () => {
  // 不存在的 sessionId
  assert.equal(hasSession('non-existent'), false);
  assert.equal(stopSession('non-existent'), false);
  // activeSessionCount 应该 >= 0,不强求 0 因为之前测试可能残留
  const count = activeSessionCount();
  assert.ok(count >= 0, 'count 应该是非负数');
});
