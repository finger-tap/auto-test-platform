// 2026-06-08: screenshot-relay.ts 单元测试 — 覆盖远端 agent fetcher
//
// 关键路径:makeRemoteAgentScreenshotFetcher POST 到 mobile-agent /screencap,
// 解析 {code, data:{image}} JSON,转回 Buffer。本地 adb / hdc fetcher 不在这测
// (需要真实设备),只测纯 HTTP 路径的远端 fetcher。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRemoteAgentScreenshotFetcher } from '../src/server/mobile-preview/screenshot-relay.js';

const SERIAL = 'test-serial-001';

test('remote fetcher — agent 返回 200 + 合法 JSON → 返回 Buffer', async () => {
  const fakeImage = Buffer.from('fake-png-bytes-12345');
  const server = await startMockAgentServer(async (_req, body) => {
    assert.equal(body.serial, SERIAL, '请求体 serial 必须匹配');
    return {
      code: 200,
      message: 'ok',
      data: { image: fakeImage.toString('base64'), ts: Date.now() },
    };
  });
  try {
    const fetcher = makeRemoteAgentScreenshotFetcher(server.url, SERIAL);
    const buf = await fetcher();
    assert.ok(buf, 'fetcher 应该返回非 null');
    assert.equal(buf!.toString('utf8'), 'fake-png-bytes-12345');
  } finally {
    await server.close();
  }
});

test('remote fetcher — agent 返回 200 但 data.image 缺失 → null', async () => {
  const server = await startMockAgentServer(async () => ({ code: 200, message: 'ok' }));
  try {
    const fetcher = makeRemoteAgentScreenshotFetcher(server.url, SERIAL);
    const buf = await fetcher();
    assert.equal(buf, null);
  } finally {
    await server.close();
  }
});

test('remote fetcher — agent 返回 500 → null(不抛)', async () => {
  const server = await startMockAgentServer(async () => ({ code: 500, message: 'screencap failed' }), 500);
  try {
    const fetcher = makeRemoteAgentScreenshotFetcher(server.url, SERIAL);
    const buf = await fetcher();
    assert.equal(buf, null);
  } finally {
    await server.close();
  }
});

test('remote fetcher — agent 拒绝连接 → null(不抛)', async () => {
  // 用一个不存在的端口(1 通常未占用)
  const fetcher = makeRemoteAgentScreenshotFetcher('http://127.0.0.1:1', SERIAL);
  const buf = await fetcher();
  assert.equal(buf, null);
});

test('remote fetcher — 路径结尾有 / 时被规范化', async () => {
  const fakeImage = Buffer.from('trim-slash-ok');
  const server = await startMockAgentServer(async () => ({
    code: 200,
    message: 'ok',
    data: { image: fakeImage.toString('base64') },
  }));
  try {
    // 注意结尾的 / — fetcher 内部应该 trim
    const fetcher = makeRemoteAgentScreenshotFetcher(server.url + '/', SERIAL);
    const buf = await fetcher();
    assert.ok(buf, 'fetcher 应该容忍 baseUrl 末尾的 /');
    assert.equal(buf!.toString('utf8'), 'trim-slash-ok');
  } finally {
    await server.close();
  }
});

// ── helpers ──

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

async function startMockAgentServer(
  handler: (req: Request, body: { serial: string }) => Promise<unknown>,
  statusOverride?: number,
): Promise<MockServer> {
  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    const out = await handler(req as unknown as Request, parsed);
    const code = statusOverride ?? 200;
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('mock server failed to bind');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
