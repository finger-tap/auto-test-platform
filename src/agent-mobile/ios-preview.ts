// 2026-06-09: mac-agent iOS 设备枚举 + 单帧截图
//
// 跑在 Mac 上的 mobile-agent 用,跟 src/agent-mobile/preview.ts(Android)
// 是兄弟关系。区别:
//   - adb / hdc → idevice_id + xcrun simctl
//   - screencap → `xcrun simctl io <udid> screenshot <path>`(模拟器)
//              → `idevicescreenshot`(真机,libimobiledevice 套件)
//
// 注意:agent 启动时 import 这个模块没问题,因为里面没有任何 native 依赖,
// 真要 exec 的 idevice_id / xcrun / idevicescreenshot 失败也只是返回 [],
// 不会让进程崩。Mac 上没装 Xcode 也能 import,只是 listLocalIos() 会返回 []。

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IDeviceIdBin = 'idevice_id';
const IDeviceInfoBin = 'ideviceinfo';
const IDeviceScreenshotBin = 'idevicescreenshot';
const XcrunBin = 'xcrun';
const SHELL_TIMEOUT_MS = 4_000;
const SCREENCAP_TIMEOUT_MS = 4_000;

export interface IosDeviceRow {
  /** udid — 模拟器或真机的统一 id;`idevice_id -l` / `simctl list` 都给这个 */
  udid: string;
  /** 'simulator' (xcrun simctl) 或 'device' (idevice_id 真机) */
  kind: 'simulator' | 'device';
  /** 人类可读名 — 模拟器 name,真机 null(用 model) */
  name: string | null;
  model: string | null;
  os_version: string | null;
  /** 'Booted' / 'Shutdown' / 'device' / 'offline' / 'unauthorized' */
  state: string;
}

/**
 * 列本机 iOS 设备 — 真机(idevice_id)+ 模拟器(xcrun simctl 已启动的)。
 * 工具不可用 / 单台设备拉取失败 → skip,不影响整体。
 * 返回的 state 字段跟 Android `adb devices` 的 state 字段对齐,server 端
 * merge.ts 可以按同一种方式处理。
 */
export async function listLocalIos(): Promise<IosDeviceRow[]> {
  if (process.platform !== 'darwin') return [];
  const out: IosDeviceRow[] = [];
  await Promise.all([listRealDevices().then((r) => out.push(...r)), listBootedSimulators().then((r) => out.push(...r))]);
  return out;
}

async function listRealDevices(): Promise<IosDeviceRow[]> {
  let raw = '';
  try {
    const { stdout } = await execFileAsync(IDeviceIdBin, ['-l'], { timeout: SHELL_TIMEOUT_MS });
    raw = stdout;
  } catch {
    // libimobiledevice 没装,或 USB 设备没插 — 静默 skip
    return [];
  }
  const udids = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  return Promise.all(udids.map(async (udid) => {
    const info = await readIdeviceInfo(udid);
    return {
      udid,
      kind: 'device' as const,
      name: null,
      model: info.model,
      os_version: info.os_version,
      state: 'device',
    };
  }));
}

async function listBootedSimulators(): Promise<IosDeviceRow[]> {
  let stdout = '';
  try {
    const r = await execFileAsync(XcrunBin, ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: SHELL_TIMEOUT_MS });
    stdout = r.stdout;
  } catch {
    return [];
  }
  let json: { devices?: Record<string, Array<{ udid: string; name: string; state: string; modelIdentifier?: string }>> };
  try {
    json = JSON.parse(stdout);
  } catch {
    console.log(`[mobile-agent:ios] simctl list output not JSON, skip`);
    return [];
  }
  const out: IosDeviceRow[] = [];
  for (const runtime of Object.keys(json.devices || {})) {
    for (const dev of json.devices[runtime] || []) {
      if (dev.state !== 'Booted') continue;
      out.push({
        udid: dev.udid,
        kind: 'simulator',
        name: dev.name,
        model: dev.modelIdentifier ?? dev.name,
        os_version: runtimeToIosVersion(runtime),
        state: dev.state,
      });
    }
  }
  return out;
}

async function readIdeviceInfo(udid: string): Promise<{ model: string | null; os_version: string | null }> {
  try {
    const { stdout } = await execFileAsync(IDeviceInfoBin, ['-u', udid], { timeout: SHELL_TIMEOUT_MS });
    const map: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) map[m[1].trim()] = m[2].trim();
    }
    return {
      model: map['ModelNumber'] || map['ProductType'] || null,
      os_version: map['ProductVersion'] || null,
    };
  } catch {
    return { model: null, os_version: null };
  }
}

/** "com.apple.CoreSimulator.SimRuntime.iOS-17-2" → "iOS 17.2" */
function runtimeToIosVersion(runtime: string): string | null {
  const m = runtime.match(/SimRuntime\.(iOS|tvOS|watchOS|visionOS)-(\d+)-(\d+)/i);
  if (!m) return null;
  return `${m[1]} ${m[2]}.${m[3]}`;
}

/**
 * 单帧截图 — 真机走 idevicescreenshot(直接 stdout PNG),模拟器走
 * `xcrun simctl io <udid> screenshot <path>`(写文件再读,simctl 不支持 stdout)。
 *
 * 失败(工具缺失 / udid 找不到)→ null,跟 Android preview.ts 同语义。
 */
export async function iosScreencapOnce(udid: string, kind: 'simulator' | 'device'): Promise<Buffer | null> {
  try {
    if (kind === 'simulator') {
      // simctl screenshot 必须落盘,先写到 tmp 再读
      const tmp = path.join(os.tmpdir(), `mid-ios-${udid}-${Date.now()}.png`);
      try {
        await execFileAsync(XcrunBin, ['simctl', 'io', udid, 'screenshot', tmp], { timeout: SCREENCAP_TIMEOUT_MS });
        const buf = await fs.readFile(tmp);
        return buf.length > 0 ? buf : null;
      } finally {
        await fs.unlink(tmp).catch(() => {});
      }
    } else {
      // idevicescreenshot 输出到 stdout
      const child = await execFileAsync(IDeviceScreenshotBin, ['-u', udid], {
        timeout: SCREENCAP_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'buffer',
      } as Parameters<typeof execFileAsync>[2]);
      const buf = child.stdout as unknown as Buffer;
      return buf.length > 0 ? buf : null;
    }
  } catch (e) {
    console.log(`[mobile-agent:ios] screencap ${kind}:${udid} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
