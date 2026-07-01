// 2026-06-08: Mobile 设备合并(本地 + 远端) — 服务 DevicePickerModal
//
// 本地:
//   Android: @midscene/android.getConnectedDevicesWithDetails() 拿 model/brand/screen,
//            再 adb shell getprop 补 os_version / sdk_int
//   Harmony: @midscene/harmony.getConnectedDevices() 拿 deviceId,
//            再 hdc shell getprop 补 model/brand/os_version/screen
//   iOS:    macOS server 才支持,见 task #107(本文件只占位)
//
// 远端:devices 表 WHERE test_type='mobile' AND user_id=?
//
// 合并:按 serial 归一。两边都有 → source='both',优先用远端的 rich info(更全);
// 缓存:30s TTL,避免每次开 modal 都重跑 adb/hdc 命令(每个设备约 200-500ms)
// IMSI:服务端永远 null(adb/hdc 无权限读 IMSI),UI 显示"需 ROOT 权限"
//
// 2026-06-10: 工具缺失守卫 — 用户的开发机没装 hdc/idevice_id/xcrun 时,直接 return [],
// 不调底层库,避免 @midscene/harmony 的 `console.error("Failed to get device list:", err)`
// + 完整 stack trace 污染 server 日志。功能不影响(merged=1 仍正常返回),噪音消失。
//
// 2026-06-10: 增加 3 个状态字段,给 DevicePickerModal 三态 badge 用:
//   - busy: 远端设备是否有 running mobile_case_executions(本地无 devices.id 行,busy 始终 false,
//     走 server 端 mutex 兜底;UI 上不展示"占用中"避免误判)
//   - viewerCount: 当前 scrcpy preview viewer 数(本地走 local-scrcpy 的共享 Map,远端走 proxy 的 in-mem 计数)
//   - previewReleasingAt: 本地 scrcpy viewer 数归零后,60s 回收 timer 触发时间(只有本地有,远端 1:1 立即关)
// 数据源:
//   - busy 批量查 `findRunningExecutionsByDeviceIds(remoteNumericIds)` 一次 N 设备,避免 N+1
//   - viewerCount 实时拉(调用很轻,只遍历小 Map)
//   - previewReleasingAt 由 lastIdleAt + SCRCPY_IDLE_TIMEOUT_MS 派生
// Cache:
//   - 原 30s TTL 保留(避免每次开 modal 都重跑 adb)
//   - 新增 `invalidateAllMergedCache()`:execute start/finish 时全清所有用户的设备列表缓存,
//     让多用户场景下 busy 状态变化 30s 内可被其他用户感知

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getConnectedDevicesWithDetails as listLocalAndroid } from '@midscene/android';
import { getConnectedDevices as listLocalHarmony } from '@midscene/harmony';
import { listDevices as listDbDevices, type DeviceRow } from '../db/devices.js';
import {
  getSharedScrcpyViewerCount,
} from '../mobile-preview/local-scrcpy.js';
import { getRemoteViewerCount } from '../mobile-preview/proxy.js';
import {
  findRunningExecutionsByDeviceIds,
  findRunningExecutionsByLocalDeviceKeys,
  type MobileCaseExecutionRow,
} from '../db/mobile-tests.js';

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 30_000;
const SHELL_TIMEOUT_MS = 4_000;
const TOOL_PROBE_TIMEOUT_MS = 1_000;
const TOOL_PROBE_TTL_MS = 5 * 60_000;
const ADB_BIN = process.env.ADB_BIN || 'adb';
const HDC_BIN = process.env.HDC_BIN || 'hdc';

export type DevicePlatform = 'android' | 'ios' | 'harmony';
export type DeviceSource = 'local' | 'remote' | 'both';

export interface ScreenSize {
  width: number;
  height: number;
  density: number;
}

export interface RichInfo {
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  // Android only. Harmony SDK 概念跟 Android 不一样(API level 不通用),留 null。
  sdk_int: number | null;
  screen_size: ScreenSize | null;
  // IMSI 永远 null。Server 端 adb/hdc 拿不到(需 ROOT);iOS macOS 端要私有 API,
  // 不在 scope。UI 文案固定"需 ROOT 权限"。
  imsi: null;
}

export interface MergedDevice {
  // 本地设备用合成 id 字符串 `local:<platform>:<serial>`;
  // 远端设备用 devices.id(number)。
  id: number | string;
  source: DeviceSource;
  name: string;
  platform: DevicePlatform;
  serial: string;
  rich_info: RichInfo;
  status: 'online' | 'offline';
  last_seen_at: string | null;
  agent_endpoint?: string | null;
  host?: string | null;
  // 仅 source ∈ {remote, both} 时存在
  remote_device_id?: number;
  // 2026-06-10: 三态 badge 字段(见文件头注释)
  busy: boolean;
  viewerCount: number;
  previewReleasingAt: number | null;
}

// ── Cache ──
interface CacheEntry { at: number; items: MergedDevice[] }
const cache = new Map<string, CacheEntry>();

function getCached(userId: number): MergedDevice[] | null {
  const key = `mobile:${userId}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.items;
}

function setCache(userId: number, items: MergedDevice[]): void {
  cache.set(`mobile:${userId}`, { at: Date.now(), items });
}

/** 暴露给路由层用 — 用户在 UI 上点 [刷新] 按钮时清缓存 */
export function invalidateMergedCache(userId: number): void {
  cache.delete(`mobile:${userId}`);
}

/**
 * 2026-06-10: 全清所有用户的设备列表缓存。
 * 用于 mobile execute start/finish 路径 — busy 状态变了,其他用户开 modal 时应该
 * 立刻看到(不阻塞到 30s TTL 过期)。N 个用户 × 30s cache,全清后最多引起 N 次
 * 重算(单次 ~200-500ms),低频操作(执行开始/结束),可接受。
 */
export function invalidateAllMergedCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith('mobile:')) cache.delete(key);
  }
}

// 2026-06-10: 工具存在性探测 — 缺失时避免触发 @midscene/harmony 的
// console.error("Failed to get device list:") + stack trace 噪音。
// 5min TTL,避免每次 merge 都 spawn 一次 --version 子进程。
const toolProbeCache = new Map<string, { at: number; available: boolean }>();

async function isCommandAvailable(cmd: string): Promise<boolean> {
  const cached = toolProbeCache.get(cmd);
  if (cached && Date.now() - cached.at < TOOL_PROBE_TTL_MS) return cached.available;
  let available = false;
  try {
    // 用 --version 这种几乎不输出的子命令触发;stderr 收掉(就算工具在但报错也不污染日志)
    await execFileAsync(cmd, ['--version'], {
      timeout: TOOL_PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    } as Parameters<typeof execFileAsync>[2]);
    available = true;
  } catch (e) {
    // ENOENT = 二进制不在 PATH;其他错(非零退出)仍视为"在" — 真的用了再说
    const code = (e as { code?: string }).code;
    available = code !== 'ENOENT';
  }
  toolProbeCache.set(cmd, { at: Date.now(), available });
  return available;
}

// ── Shell helpers ──

async function runAdbShell(serial: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(ADB_BIN, ['-s', serial, 'shell', ...args], { timeout: SHELL_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function runHdcShell(serial: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(HDC_BIN, ['-t', serial, 'shell', ...args], { timeout: SHELL_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseScreenSize(res: string, density: number): ScreenSize | null {
  // res 形如 "1080x2400",或 hdc 输出带前缀 "Physical size: 1080x2400"
  const cleaned = res.replace(/^[^\d]+/, '');
  const m = cleaned.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]), density: density || 0 };
}

// ── Local enumeration ──

interface LocalDeviceDetail extends RichInfo { udid: string; }

async function listLocalAndroidDetailed(): Promise<LocalDeviceDetail[]> {
  let basic: Awaited<ReturnType<typeof listLocalAndroid>> = [];
  try {
    basic = await listLocalAndroid();
  } catch (e) {
    // adb 不在 PATH / 没启动 adb server — 不报错,只记一行日志
    console.log(`[devices:merge] android enumeration failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  if (basic.length === 0) return [];

  return Promise.all(basic.map(async (d) => {
    const [osVersionRaw, sdkRaw] = await Promise.all([
      runAdbShell(d.udid, ['getprop', 'ro.build.version.release']),
      runAdbShell(d.udid, ['getprop', 'ro.build.version.sdk']),
    ]);
    return {
      udid: d.udid,
      manufacturer: d.brand ?? null,
      model: d.model ?? null,
      os_version: osVersionRaw,
      sdk_int: sdkRaw ? Number(sdkRaw) || null : null,
      screen_size: d.resolution ? parseScreenSize(d.resolution, d.density ?? 0) : null,
      imsi: null,
    };
  }));
}

async function listLocalHarmonyDetailed(): Promise<LocalDeviceDetail[]> {
  // 2026-06-10: 工具缺失守卫。hdc 不在 PATH 时直接 return [],避免触发
  // @midscene/harmony 库内部的 console.error("Failed to get device list:") + stack trace。
  // (库的 catch 在 throw 之前先打 error 日志,我们在外层 catch 不到,只能前置拦截)
  if (!(await isCommandAvailable(HDC_BIN))) {
    return [];
  }
  let basic: Awaited<ReturnType<typeof listLocalHarmony>> = [];
  try {
    basic = await listLocalHarmony();
  } catch (e) {
    console.log(`[devices:merge] harmony enumeration failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  if (basic.length === 0) return [];

  return Promise.all(basic.map(async (d) => {
    const [brand, model, osv, size, density] = await Promise.all([
      runHdcShell(d.deviceId, ['getprop', 'ro.product.brand']),
      runHdcShell(d.deviceId, ['getprop', 'ro.product.model']),
      runHdcShell(d.deviceId, ['getprop', 'os.build.version.release']),
      runHdcShell(d.deviceId, ['wm', 'size']),
      runHdcShell(d.deviceId, ['wm', 'density']),
    ]);
    let screen: ScreenSize | null = null;
    if (size) screen = parseScreenSize(size, Number(density) || 0);
    return {
      udid: d.deviceId,
      manufacturer: brand,
      model,
      os_version: osv,
      sdk_int: null,
      screen_size: screen,
      imsi: null,
    };
  }));
}

/** 2026-06-08: iOS 本地枚举(macOS server only)。
 *
 * 数据源:
 *   - 真机: `idevice_id -l` 拿 udid,再 `ideviceinfo -u <udid>` 拿 productType/productVersion
 *   - 模拟器: `xcrun simctl list devices booted -j` 拿已启动的 simulator(只列 booted,
 *            其他启动状态的用户自己手动 xcrun simctl boot)
 *
 * 失败 / 工具缺失:
 *   - 任意工具不可用(simulators 装了但 libimobiledevice 没装,或反之)→ skip 这一类
 *   - 单个设备 info 拉不到 → 该设备 manufacturer/model 设 null,不阻塞整个列表
 *
 * IMSI:永远 null。私有 API,不在 scope。UI 文案固定"需 ROOT 权限"。
 *
 * 注意:实测要 macOS + iOS 工具链,本开发机(linux)走不到 → 整函数返回 [].开发机
 * 调试 UI 时不会因为这条日志 spam(只在 process.platform==='darwin' 时打)。
 */
async function listLocalIosDetailed(): Promise<LocalDeviceDetail[]> {
  if (process.platform !== 'darwin') return [];
  // 2026-06-10: iOS 工具缺失守卫 — 没装 Xcode CLT 时 `xcrun: error: unable to find
  // utility "simctl"` 之类的 stderr 会喷一堆,前置 isCommandAvailable 探测后整体跳过,
  // 不打那种"看着像 bug 实际只是没装工具"的日志。
  const hasXcrun = await isCommandAvailable('xcrun');
  const hasIdevice = await isCommandAvailable('idevice_id');
  if (!hasXcrun && !hasIdevice) return [];

  const out: LocalDeviceDetail[] = [];

  // 1. 真机:idevice_id -l(工具缺失前置拦截,这里只处理"工具在但出错"的情况)
  if (hasIdevice) {
    try {
      const { stdout } = await execFileAsync('idevice_id', ['-l'], { timeout: SHELL_TIMEOUT_MS });
      const udids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const udid of udids) {
        const info = await readIdeviceInfo(udid);
        out.push({
          udid,
          manufacturer: info.manufacturer ?? 'Apple',
          model: info.model,
          os_version: info.os_version,
          sdk_int: null,
          screen_size: null,   // 私有 API,懒得查
          imsi: null,
        });
      }
    } catch (e) {
      console.log(`[devices:merge] ios real-device enumeration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. 模拟器:xcrun simctl list devices booted -j
  if (hasXcrun) {
    try {
      const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: SHELL_TIMEOUT_MS });
      const json = JSON.parse(stdout) as {
        devices: Record<string, Array<{ udid: string; name: string; state: string; modelIdentifier?: string }>>;
      };
      for (const runtime of Object.keys(json.devices || {})) {
        for (const dev of json.devices[runtime] || []) {
          if (dev.state !== 'Booted') continue;
          out.push({
            udid: dev.udid,
            manufacturer: 'Apple',
            model: dev.modelIdentifier ?? dev.name,
            os_version: runtimeToIosVersion(runtime),
            sdk_int: null,
            screen_size: null,
            imsi: null,
          });
        }
      }
    } catch (e) {
      console.log(`[devices:merge] ios simulator enumeration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return out;
}

async function readIdeviceInfo(udid: string): Promise<{ manufacturer: string | null; model: string | null; os_version: string | null }> {
  try {
    const { stdout } = await execFileAsync('ideviceinfo', ['-u', udid], { timeout: SHELL_TIMEOUT_MS });
    const map: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) map[m[1].trim()] = m[2].trim();
    }
    return {
      manufacturer: map['Manufacturer'] || 'Apple',
      model: map['ModelNumber'] || map['ProductType'] || null,
      os_version: map['ProductVersion'] || null,
    };
  } catch {
    return { manufacturer: null, model: null, os_version: null };
  }
}

/** simulator runtime 字符串 "com.apple.CoreSimulator.SimRuntime.iOS-17-2" → "iOS 17.2" */
function runtimeToIosVersion(runtime: string): string | null {
  const m = runtime.match(/SimRuntime\.(iOS|tvOS|watchOS|visionOS)-(\d+)-(\d+)/i);
  if (!m) return null;
  return `${m[1]} ${m[2]}.${m[3]}`;
}

// ── Remote (from devices table) ──

function listRemoteMobile(userId: number): DeviceRow[] {
  return listDbDevices(userId, { test_type: 'mobile' });
}

function remoteRowToMerged(row: DeviceRow): MergedDevice {
  // 远端 mobile-agent 上报时把 rich info 写在 metadata 里(JSON 字符串);
  // 远端没上报过(或上报失败)时,各字段保持 null。
  let meta: Partial<RichInfo> = {};
  try {
    if (row.metadata) meta = JSON.parse(row.metadata);
  } catch { /* 解析失败 = 老数据或被破坏,忽略 */ }
  return {
    id: row.id,
    source: 'remote',
    name: row.name,
    platform: (['android', 'ios', 'harmony'] as const).includes(row.platform as DevicePlatform)
      ? (row.platform as DevicePlatform)
      : 'android',
    serial: row.serial ?? '',
    rich_info: {
      manufacturer: meta.manufacturer ?? null,
      model: meta.model ?? null,
      os_version: meta.os_version ?? null,
      sdk_int: meta.sdk_int ?? null,
      screen_size: meta.screen_size ?? null,
      imsi: null,
    },
    status: row.status === 'online' ? 'online' : 'offline',
    last_seen_at: row.last_seen_at,
    agent_endpoint: row.agent_endpoint,
    host: row.host,
    remote_device_id: row.id,
    // 三态字段:listMergedMobileDevices 末尾会调 enrichDeviceState 覆盖
    busy: false,
    viewerCount: 0,
    previewReleasingAt: null,
  };
}

// ── Merge ──

function mergePair(local: MergedDevice, remote: MergedDevice): MergedDevice {
  // 远端的 rich info 优先(更全),本地能补的字段(如 os_version)再覆盖。
  const ri: RichInfo = {
    manufacturer: remote.rich_info.manufacturer ?? local.rich_info.manufacturer,
    model: remote.rich_info.model ?? local.rich_info.model,
    os_version: local.rich_info.os_version ?? remote.rich_info.os_version,
    sdk_int: local.rich_info.sdk_int ?? remote.rich_info.sdk_int,
    screen_size: local.rich_info.screen_size ?? remote.rich_info.screen_size,
    imsi: null,
  };
  return {
    // 远端 id 持久化,后续 preview/执行都用它
    id: remote.id,
    source: 'both',
    name: remote.name,
    platform: local.platform,
    serial: local.serial,
    rich_info: ri,
    status: 'online',
    last_seen_at: remote.last_seen_at,
    agent_endpoint: remote.agent_endpoint,
    host: remote.host,
    remote_device_id: remote.remote_device_id,
    // 三态字段:listMergedMobileDevices 末尾会调 enrichDeviceState 覆盖
    busy: false,
    viewerCount: 0,
    previewReleasingAt: null,
  };
}

function localToMerged(d: LocalDeviceDetail, platform: 'android' | 'harmony' | 'ios'): MergedDevice {
  return {
    id: `local:${platform}:${d.udid}`,
    source: 'local',
    name: d.model || d.udid,
    platform,
    serial: d.udid,
    rich_info: { ...d, imsi: null },
    status: 'online',
    last_seen_at: null,
    host: '127.0.0.1',
    // 三态字段:listMergedMobileDevices 末尾会调 enrichDeviceState 覆盖
    busy: false,
    viewerCount: 0,
    previewReleasingAt: null,
  };
}

/**
 * 只扫描本机 USB 连接的手机（Android / HarmonyOS / iOS），不查远程 agent。
 * 返回格式与 fetchMobileDevicesFromAgent 一致（MobileDeviceFromAgent），
 * 供「本机」选择后获取手机列表使用。
 */
export async function listLocalMobileDevices(): Promise<Array<{
  serial: string;
  platform: 'android' | 'harmony' | 'ios';
  model: string | null;
  os_version: string | null;
  status: string;
}>> {
  const [androidLocal, harmonyLocal, iosLocal] = await Promise.all([
    listLocalAndroidDetailed(),
    listLocalHarmonyDetailed(),
    listLocalIosDetailed(),
  ]);
  const mapDevice = (d: LocalDeviceDetail, platform: 'android' | 'harmony' | 'ios') => ({
    serial: d.udid,
    platform,
    model: d.model ?? null,
    os_version: d.os_version ?? null,
    status: 'online',
  });
  return [
    ...androidLocal.map(d => mapDevice(d, 'android')),
    ...harmonyLocal.map(d => mapDevice(d, 'harmony')),
    ...iosLocal.map(d => mapDevice(d, 'ios')),
  ];
}

export async function listMergedMobileDevices(userId: number): Promise<MergedDevice[]> {
  const cached = getCached(userId);
  if (cached) return cached;

  const [androidLocal, harmonyLocal, iosLocal, remoteRows] = await Promise.all([
    listLocalAndroidDetailed(),
    listLocalHarmonyDetailed(),
    listLocalIosDetailed(),
    Promise.resolve(listRemoteMobile(userId)),
  ]);

  const localItems: MergedDevice[] = [
    ...androidLocal.map((d) => localToMerged(d, 'android')),
    ...harmonyLocal.map((d) => localToMerged(d, 'harmony')),
    ...iosLocal.map((d) => localToMerged(d, 'ios')),
  ];
  const remoteItems: MergedDevice[] = remoteRows.map(remoteRowToMerged);

  // 按 serial 归一。serial 为空的远端行(老数据或非 adb/hdc 设备)直接追加。
  const bySerial = new Map<string, { local?: MergedDevice; remote?: MergedDevice }>();
  const indexLocal = (it: MergedDevice) => {
    if (!it.serial) return;
    const prev: { local?: MergedDevice; remote?: MergedDevice } = bySerial.get(it.serial) || {};
    bySerial.set(it.serial, { ...prev, local: it });
  };
  const indexRemote = (it: MergedDevice) => {
    if (!it.serial) return;
    const prev: { local?: MergedDevice; remote?: MergedDevice } = bySerial.get(it.serial) || {};
    bySerial.set(it.serial, { ...prev, remote: it });
  };
  localItems.forEach(indexLocal);
  remoteItems.forEach(indexRemote);

  const merged: MergedDevice[] = [];
  for (const pair of bySerial.values()) {
    if (pair.local && pair.remote) merged.push(mergePair(pair.local, pair.remote));
    else if (pair.local) merged.push(pair.local);
    else if (pair.remote) merged.push(pair.remote);
  }
  // serial 为空的远端行(legacy data)追加到末尾
  for (const r of remoteItems) if (!r.serial) merged.push(r);

  // 2026-06-10: 三态字段补全 — busy 一次批量查,viewerCount/releasingAt 实时拉
  const remoteNumericIds = merged
    .filter((d) => typeof d.id === 'number')
    .map((d) => d.id as number);
  const runningMap = findRunningExecutionsByDeviceIds(remoteNumericIds);
  // 2026-06-11: 本地设备也走 DB busy check — 收集所有本地设备的 localDeviceKey
  const localKeys = merged
    .filter((d) => typeof d.id === 'string')
    .map((d) => `local:${d.platform}:${d.serial}`);
  const localRunningMap = findRunningExecutionsByLocalDeviceKeys(localKeys);
  const enriched = merged.map((d) => enrichDeviceState(d, runningMap, localRunningMap));

  console.log(`[devices:merge] user=${userId} local=${localItems.length} remote=${remoteItems.length} merged=${enriched.length} busy=${enriched.filter(d => d.busy).length} viewing=${enriched.filter(d => d.viewerCount > 0).length}`);
  setCache(userId, enriched);
  return enriched;
}

/**
 * 2026-06-10: 给单个 MergedDevice 补三态字段。
 *   - 远端(id=number,含 source='both' 因为 id 沿用远端):
 *     busy = runningMap.has(id),viewerCount = getRemoteViewerCount(id)
 *   - 本地(id=string 'local:...'):busy 始终 false(server 端 mutex 兜底;mobile_case_executions
 *     本地执行的 device_id 是 NULL,partial UNIQUE INDEX 不覆盖,UI 不展示避免误判),
 *     viewerCount 走 local-scrcpy 共享 Map,viewerCount===0 时给出 previewReleasingAt
 */
function enrichDeviceState(
  d: MergedDevice,
  runningMap: Map<number, MobileCaseExecutionRow>,
  localRunningMap: Map<string, MobileCaseExecutionRow>,
): MergedDevice {
  if (typeof d.id === 'number') {
    return {
      ...d,
      busy: runningMap.has(d.id),
      viewerCount: getRemoteViewerCount(d.id),
      previewReleasingAt: null,  // 远端 1:1,viewer 离开立即关
    };
  }
  // local 路径 — busy 走 DB(local_device_key 列)
  const localLockKey = `local:${d.platform}:${d.serial}`;
  const isBusy = localRunningMap.has(localLockKey);
  const viewerCount = getSharedScrcpyViewerCount(d.serial);
  return {
    ...d,
    busy: isBusy,
    viewerCount,
    previewReleasingAt: null,
  };
}
