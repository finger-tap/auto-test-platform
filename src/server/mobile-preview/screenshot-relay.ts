// 2026-06-08: 截图轮询 → SSE-PNG(Android / Harmony / iOS 通用)
//
// 为什么先不做 scrcpy / MJPEG:
//   1. 三平台 adb / hdc / WDA 都暴露"取一帧"接口,实现一致 ≈ 30 行
//   2. 1-2 FPS 够执行过程监控用(Midscene 单步 5-30s,中间不需要 30 FPS)
//   3. 前端只要 <img src="data:image/png;base64,..."> 循环,零依赖解码器
// 后续若用户对流畅度不满,Android 可升级 scrcpy H.264,iOS 升级 WDA MJPEG,都只换这一个文件。
//
// 协议:Server-Sent Events
//   event: frame
//   data: { ts: 1717821000000, image: "base64..." }   ← 字节是 PNG(adb screencap -p / hdc / WDA 都返 PNG)
//   空行分隔
//
// 客户端:EventSource('GET /api/mobile/preview/stream?sessionId=xxx&token=yyy')
//        → 每次 message 拿 {ts, image} → 塞 <img src="data:image/png;base64,...">

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const execFileAsync = promisify(execFile);

const ADB_BIN = process.env.ADB_BIN || 'adb';
const HDC_BIN = process.env.HDC_BIN || 'hdc';
const FRAME_INTERVAL_MS = 600;       // ≈ 1.6 FPS,够用
const SCREENSHOT_TIMEOUT_MS = 4_000;

export type ScreenshotPlatform = 'android' | 'harmony' | 'ios';

/**
 * 拉一帧截图的最小接口。返回 Buffer 或 null(失败时)。
 * 不同平台的实现细节不一样(adb exec-out / hdc shell + fileRecv / WDA HTTP GET),
 * 全部 throw 走外层 catch,内部已转 null。
 */
export type ScreenshotFetcher = () => Promise<Buffer | null>;

export function makeAdbScreenshotFetcher(serial: string): ScreenshotFetcher {
  return async () => {
    try {
      // `exec-out` 不加 \r\n 行尾,直接吐 binary;`screencap -p` 输出 PNG
      // encoding: 'buffer' 让 stdout 是 Buffer 而不是 string(后者会把 PNG 字节当 utf-8 解码)
      const child = await execFileAsync(
        ADB_BIN, ['-s', serial, 'exec-out', 'screencap', '-p'],
        { timeout: SCREENSHOT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' } as Parameters<typeof execFileAsync>[2],
      );
      const stdout = child.stdout as unknown as Buffer;
      return stdout.length > 0 ? stdout : null;
    } catch (e) {
      console.log(`[preview:screenshot] adb ${serial} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
}

export function makeHdcScreenshotFetcher(serial: string): ScreenshotFetcher {
  return async () => {
    try {
      // Harmony hdc 不像 adb 有 `exec-out`,分两步:写到 /data/local/tmp 再 file recv
      const tmpPath = '/data/local/tmp/_mid_preview.png';
      await execFileAsync(HDC_BIN, ['-t', serial, 'shell', 'screencap', '-p', tmpPath], { timeout: SCREENSHOT_TIMEOUT_MS });
      const child = await execFileAsync(HDC_BIN, ['-t', serial, 'file', 'recv', tmpPath, '/dev/stdout'], {
        timeout: SCREENSHOT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'buffer',
      } as Parameters<typeof execFileAsync>[2]);
      const stdout = child.stdout as unknown as Buffer;
      // 删文件(忽略错误,下次覆盖即可)
      execFileAsync(HDC_BIN, ['-t', serial, 'shell', 'rm', '-f', tmpPath]).catch(() => {});
      return stdout.length > 0 ? stdout : null;
    } catch (e) {
      console.log(`[preview:screenshot] hdc ${serial} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
}

export function makeWdaScreenshotFetcher(wdaBaseUrl: string): ScreenshotFetcher {
  return async () => {
    try {
      // WDA 的 GET /screenshot 返回 { value: "base64..." } JSON
      // 失败 / WDA 没起 → null
      const res = await fetch(`${wdaBaseUrl.replace(/\/$/, '')}/screenshot`, { signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS) });
      if (!res.ok) return null;
      const json = (await res.json()) as { value?: string };
      if (!json.value) return null;
      return Buffer.from(json.value, 'base64');
    } catch (e) {
      console.log(`[preview:screenshot] wda ${wdaBaseUrl} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
}

/**
 * 2026-06-08: 远端 mobile-agent fetcher — server 端 POST 到 agent 的
 * `/screencap` 端点(agent 自己跑 adb / hdc,然后把 PNG base64 回传)。
 * 这是「远端 device + 远端 adb-server」组合的关键:server 端不直接 adb,
 * 走 HTTP 经 agent 中转。
 *
 * 协议参考 src/agent-mobile/index.ts 的 POST /screencap:
 *   请求:  POST {agentBase}/screencap  body: { serial: string }
 *   响应:  { code: 200, data: { image: base64, ts: number } }
 */
export function makeRemoteAgentScreenshotFetcher(agentBaseUrl: string, serial: string): ScreenshotFetcher {
  const baseUrl = agentBaseUrl.replace(/\/$/, '');
  return async () => {
    try {
      const res = await fetch(`${baseUrl}/screencap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serial }),
        signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.log(`[preview:screenshot] remote agent ${baseUrl} /screencap http=${res.status}`);
        return null;
      }
      const json = (await res.json()) as { code?: number; data?: { image?: string } };
      const image = json?.data?.image;
      if (typeof image !== 'string' || !image) return null;
      return Buffer.from(image, 'base64');
    } catch (e) {
      console.log(`[preview:screenshot] remote agent ${baseUrl} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
}

/**
 * 把 fetcher 循环吐出来的帧打成 SSE 帧。返回一个 Node Readable,
 * 由 route handler pipe 到 `res`。AbortController 触发时优雅关闭。
 *
 * @param fetcher    拉帧函数,返回 Buffer / null
 * @param onFrame    每收到一帧就调(用于更新 DB 的 total_frames / last_frame_at),
 *                   出错时由调用方负责不抛
 * @param intervalMs 拉帧间隔(毫秒);不传走默认 FRAME_INTERVAL_MS(≈ 1.6 FPS)。
 *                   MJPEG kind 走 200ms(5 FPS)给前端更高刷新率。
 */
export function makeScreenshotSseStream(
  fetcher: ScreenshotFetcher,
  onFrame?: () => void,
  intervalMs: number = FRAME_INTERVAL_MS,
): Readable {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const stream = new Readable({
    read() { /* noop — 我们 push 数据 */ },
  });

  const send = (event: string, data: unknown) => {
    if (stopped) return;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    stream.push(`event: ${event}\ndata: ${payload}\n\n`);
  };

  const tick = async () => {
    if (stopped) return;
    const buf = await fetcher();
    if (buf) {
      send('frame', { ts: Date.now(), image: buf.toString('base64') });
      onFrame?.();
    } else {
      // 拉帧失败,告诉前端"暂时无画面",不要让 <img> 卡死
      send('noop', { ts: Date.now() });
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  // 启动
  send('ready', { ts: Date.now() });
  tick();

  // 关闭 hook — 调用 stream.destroy() 时清理 timer
  const cleanup = () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
  };
  stream.on('close', cleanup);
  stream.on('error', cleanup);

  return stream;
}
