// 2026-06-09: mobile-agent 端三平台设备枚举 + 单帧截图
//
// 跟 src/agent-mobile/scrcpy.ts(Android H.264 推流)是兄弟关系。
// 三个平台:
//   - Android:  adb 工具链(`adb devices -l` + getprop)
//   - Harmony:  hdc 工具链(`hdc list targets -v` + hdc shell getprop)
//   - iOS:      xcrun simctl(模拟器)+ idevice_id(真机) + idevicescreenshot
//
// 设计原则:
//   - agent 跑在 Linux(Android/Harmony)/Mac(全平台)同一份 bundle,platform dispatch
//     靠 `process.platform` 决定 iOS 工具是否可用。
//   - iOS 工具依赖 Xcode / libimobiledevice,本机没装只是返回 [],不会让进程崩。
//   - 单帧截图:Android/Harmony 走 `exec-out screencap -p` / `shell screencap -p`;
//     iOS 走 `xcrun simctl io <udid> screenshot`(模拟器) / `idevicescreenshot`(真机)。
//   - server 端 preview-relay 已经会按 platform 选不同 relay(scrcpy/mjpeg/screenshot),
//     agent 这一层统一 `screencapOnce(serial, platform)` 出口,平台判断下沉到 caller。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ADB_BIN = process.env.ADB_BIN || 'adb';
const HDC_BIN = process.env.HDC_BIN || 'hdc';
const SCREENCAP_TIMEOUT_MS = 4_000;
const HDCLIST_TIMEOUT_MS = 5_000;
const HDCGETPROP_TIMEOUT_MS = 3_000;

export type MobilePlatform = 'android' | 'harmony' | 'ios';

/**
 * 统一设备行(给 server 端 register/heartbeat 上报用)。
 * `kind` 字段跟 Android `adb devices` / iOS `idevice_id` / Harmony `hdc list`
 * 的 `state` 字段语义对齐:在线=`device`/`Booted`,离线=`offline`/`Shutdown`。
 */
export interface MobileDeviceRow {
  /** 平台 — caller 调 screencapOnce 时原样传回 */
  platform: MobilePlatform;
  /** adb serial / hdc udid / iOS udid(40-char hex) — 跟 server devices.serial 字段对齐 */
  serial: string;
  /** 设备当前状态,具体值按 platform 略不同(详见 listLocal*) */
  state: string;
  /** 人类可读名 — Android 来自 getprop ro.product.model,iOS 来自 simctl name,失败时 null */
  name: string | null;
  model: string | null;
  brand: string | null;
  os_version: string | null;
  /** Android 专属,其它平台 null */
  sdk_int: number | null;
  /** iOS 专属('simulator' | 'device'),其它平台 null */
  ios_kind: 'simulator' | 'device' | null;
}

// ===================== Android =====================

/**
 * 列本机 adb 设备(用 `adb devices -l`),并对每台补 getprop 拿 model/brand/os/sdk。
 * 跟 server 端 devices/merge.ts 的逻辑同形,只是少一个远端 DB join。
 */
export async function listLocalAndroid(): Promise<MobileDeviceRow[]> {
  let raw = '';
  try {
    const { stdout } = await execFileAsync(ADB_BIN, ['devices', '-l'], { timeout: 5_000 });
    raw = stdout;
  } catch (e) {
    console.log(`[mobile-agent:preview] adb devices failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  // 解析:每行形如 `emulator-5554  device product:sdk_google_phone_x86 model:Pixel_5 device:bramble transport_id:1`
  const lines = raw.split('\n').slice(1);   // 跳过 "List of devices attached"
  const rows: MobileDeviceRow[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    rows.push({ platform: 'android', serial, state, name: null, model: null, brand: null, os_version: null, sdk_int: null, ios_kind: null });
  }
  // 并行 getprop 补全 model/brand/os/sdk
  await Promise.all(rows.map(async (r) => {
    if (r.state !== 'device') return;
    const [model, brand, osv, sdk] = await Promise.all([
      adbGetprop(r.serial, 'ro.product.model'),
      adbGetprop(r.serial, 'ro.product.brand'),
      adbGetprop(r.serial, 'ro.build.version.release'),
      adbGetprop(r.serial, 'ro.build.version.sdk'),
    ]);
    r.model = model;
    r.brand = brand;
    r.os_version = osv;
    r.name = model;
    r.sdk_int = sdk ? Number(sdk) || null : null;
  }));
  return rows;
}

async function adbGetprop(serial: string, prop: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(ADB_BIN, ['-s', serial, 'shell', 'getprop', prop], { timeout: 3_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function adbScreencapOnce(serial: string): Promise<Buffer | null> {
  try {
    const child = await execFileAsync(
      ADB_BIN, ['-s', serial, 'exec-out', 'screencap', '-p'],
      { timeout: SCREENCAP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' } as Parameters<typeof execFileAsync>[2],
    );
    const stdout = child.stdout as unknown as Buffer;
    return stdout.length > 0 ? stdout : null;
  } catch (e) {
    console.log(`[mobile-agent:preview] adb screencap ${serial} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ===================== Harmony =====================

/**
 * 列本机 hdc 设备。
 * - 工具不在 PATH / 没设备 → []
 * - 解析 `hdc list targets -v` 的输出:
 *     [Empty]        ← 没设备
 *     0123456789ABCDEF         device    abi=arm64-v8a   ...   <udid 行>
 *   设备行实际是首列 udid + 末列 state。`-v` 模式下 abi/version 等元数据在中间
 *   空格分隔的 k=v 段里。失败行 skip(部分字段缺失很正常,hdc 偶发抽风)。
 */
export async function listLocalHarmony(): Promise<MobileDeviceRow[]> {
  let raw = '';
  try {
    const { stdout } = await execFileAsync(HDC_BIN, ['list', 'targets', '-v'], { timeout: HDCLIST_TIMEOUT_MS });
    raw = stdout;
  } catch (e) {
    // hdc 没装 / 不在 PATH — 静默 skip,Linux server 上 Harmony 是 optional
    console.log(`[mobile-agent:preview] hdc list targets failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  const rows: MobileDeviceRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[Empty]') continue;
    // 设备行第一列是 udid,末列通常是 state(device / offline / unauthorized)
    // hdc 偶尔输出(空 udid)的"装饰行",靠 split 长度过滤
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    if (!serial) continue;
    const state = parts[parts.length - 1];
    rows.push({
      platform: 'harmony', serial, state,
      name: null, model: null, brand: null, os_version: null, sdk_int: null, ios_kind: null,
    });
  }
  // 并行 hdc shell getprop 补全 brand/model/os — 失败就 null,不影响其它设备
  await Promise.all(rows.map(async (r) => {
    if (r.state !== 'device') return;
    const [brand, model, osv] = await Promise.all([
      hdcGetprop(r.serial, 'ro.product.brand'),
      hdcGetprop(r.serial, 'ro.product.model'),
      hdcGetprop(r.serial, 'os.build.version.release'),
    ]);
    r.brand = brand;
    r.model = model;
    r.name = model;
    r.os_version = osv;
  }));
  return rows;
}

async function hdcGetprop(serial: string, prop: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(HDC_BIN, ['-t', serial, 'shell', 'getprop', prop], { timeout: HDCGETPROP_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function hdcScreencapOnce(serial: string): Promise<Buffer | null> {
  try {
    const child = await execFileAsync(
      HDC_BIN, ['-t', serial, 'shell', 'screencap', '-p'],
      { timeout: SCREENCAP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' } as Parameters<typeof execFileAsync>[2],
    );
    const stdout = child.stdout as unknown as Buffer;
    return stdout.length > 0 ? stdout : null;
  } catch (e) {
    console.log(`[mobile-agent:preview] hdc screencap ${serial} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ===================== iOS =====================
//
// iOS 工具依赖 Xcode(simctl)+ libimobiledevice(idevice_id / idevicescreenshot),
// Mac 上没装也只是返回 []。模块里没有任何 native 依赖,Linux 进程 import 也安全。
import { listLocalIos, type IosDeviceRow } from './ios-preview.js';

function iosRowToMobileRow(r: IosDeviceRow): MobileDeviceRow {
  return {
    platform: 'ios',
    serial: r.udid,
    state: r.state,
    name: r.name ?? r.model,
    model: r.model,
    brand: r.kind === 'simulator' ? 'Apple' : 'Apple',   // iOS 没"厂商"概念,统一 Apple
    os_version: r.os_version,
    sdk_int: null,
    ios_kind: r.kind,
  };
}

// ===================== 统一入口 =====================

/**
 * 列本机所有 mobile 设备 — Android + Harmony 总是查;iOS 只在 Mac 上查。
 * 工具不可用 / 某平台一台设备拉取失败 → skip,不影响整体。
 */
export async function listLocalMobile(): Promise<MobileDeviceRow[]> {
  const tasks: Array<Promise<MobileDeviceRow[]>> = [
    listLocalAndroid().catch((e) => {
      console.log(`[mobile-agent:preview] listLocalAndroid threw: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }),
    listLocalHarmony().catch((e) => {
      console.log(`[mobile-agent:preview] listLocalHarmony threw: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }),
  ];
  if (process.platform === 'darwin') {
    tasks.push(listLocalIos().then((rows) => rows.map(iosRowToMobileRow)).catch((e) => {
      console.log(`[mobile-agent:preview] listLocalIos threw: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }));
  }
  const all = await Promise.all(tasks);
  return all.flat();
}

/**
 * 单帧截图 — 按 platform 分发到底层工具。
 * 失败(工具缺失 / serial 找不到)→ null,跟旧 screencapOnce 语义一致。
 *
 * caller 必须传 platform — serial 本身不能可靠区分 iOS UDID 跟 hdc serial,
 * 强行用正则推断容易跟未来 hdc 长度变化撞车。
 */
export async function screencapOnce(serial: string, platform: MobilePlatform): Promise<Buffer | null> {
  if (platform === 'android') return adbScreencapOnce(serial);
  if (platform === 'harmony') return hdcScreencapOnce(serial);
  // iOS
  const ios = await import('./ios-preview.js');
  const row = (await listLocalIos()).find((d) => d.udid === serial);
  if (!row) {
    console.log(`[mobile-agent:preview] iOS screencap: udid=${serial} not found in listLocalIos`);
    return null;
  }
  return ios.iosScreencapOnce(serial, row.kind);
}

/**
 * 兜底 — 一些 caller(比如 server 端从旧 DB 行读出来)只有 serial 没有 platform。
 * 启发式:40 位 hex 几乎都是 iOS UDID;带连字符(emulator-5554)算 Android;其它按 Android 处理。
 * **不要** 在生产路径上只靠这个 — caller 优先自己记录 platform,这里只是给老数据兜底。
 */
export function inferPlatformFromSerial(serial: string): MobilePlatform {
  if (/^[0-9a-f]{40}$/i.test(serial)) return 'ios';
  return 'android';
}
