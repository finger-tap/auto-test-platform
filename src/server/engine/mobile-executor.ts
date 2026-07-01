// Mobile test executor — Android/iOS/Harmony automation via Midscene
// Reference: @midscene/android, @midscene/ios, @midscene/harmony
//
// 2026-06-08: Full NL/YAML rewrite. The 10-action switch (executeAndroidStep /
// executeIOSStep) is REMOVED — old `test_script` rows (pre-2026-06-04) are
// no longer executable. The column is kept in the DB for back-read of
// historical logs only. New code stores case_content (text → aiAct, yaml →
// runYaml), the same path used by web/pc executors. Added Harmony branch
// for HarmonyOS NEXT devices via @midscene/harmony's `agentFromHdcDevice`.
//
// 2026-06-09: 远端设备执行路径落地。
//   - Android: 远端设备用 SSH LocalForward 把远端 adb-server (5037) 透到 server 本地
//     随机端口,然后 adb 客户端(被 Midscene 内部调用)把 127.0.0.1:<local> 当本地
//     adb 用。@midscene/android 的 `agentFromAdbDevice(serial)` 不接受 host/port,
//     只接受 serial — 我们通过 ADB_SERVER_PORT 环境变量或 adb -P 切换不到,
//     所以改用 `agentFromAdbDevice` 之前先 export ADB_SERVER_PORT=tcp:127.0.0.1:<port>。
//     @midscene/android 内部走 `adb connect` (look at source),如果设置了
//     ADB_SERVER_SOCKET 它会走这条;否则走 adb 默认 5037。我们走环境变量最稳。
//   - Harmony: 同样,@midscene/harmony 用 hdc。hdc 也有 HDC_SERVER_PORT 类似 env
//     (HDC_SERVER_SOCKET 或 HDC_SERVER_PORT);Linux 上 hdc 走 5037,我们 export 后生效。
//   - iOS: 远端 iOS 在 Mac 上跑 WDA(8100)。@midscene/ios 的
//     `agentFromWebDriverAgent({wdaHost, wdaPort})` 显式支持。我们 SSH 隧道 8100,
//     然后传 `agentFromWebDriverAgent({wdaHost: '127.0.0.1', wdaPort: tunneledPort})`,
//     并跳过 checkIOSEnvironment(那只是检查本地 WDA,远端时 WDA 在 mac 上)。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentFromAdbDevice, AndroidAgent } from '@midscene/android';
import { agentFromWebDriverAgent, IOSAgent } from '@midscene/ios';
import { agentFromHdcDevice, HarmonyAgent } from '@midscene/harmony';
import { getDevice, type DeviceRow } from '../db/devices.js';
import { findMobileAppById, type MobileAppVersion } from '../db/mobile-apps.js';
import { decryptColumn } from '../agent-push/crypto.js';
import { openSshTunnel, type ActiveTunnel, type SshCredsForTunnel } from '../devices/ssh-tunnel.js';
import type { MobileTestCaseRow } from '../db/mobile-tests.js';
import { installAppOnDevice } from './app-installer.js';
import { resolvePreconditionText } from './nl-steps.js';
import { substituteVars } from './vars.js';
import { applyUserMidsceneConfig, getAgentOptOverrides } from './midscene-config.js';
import {
  generateReportPath,
  reportFileName,
  ensureReportDir,
  type TestType,
} from './report-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// 2026-06-23: serialize env-var–setting critical sections so two concurrent
// remote-device tests don't overwrite each other's ADB_SERVER_SOCKET / HDC_SERVER_PORT.
let _envMutex: Promise<void> = Promise.resolve();
function withEnvMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = _envMutex.then(fn, fn);
  _envMutex = next.then(() => {}, () => {});
  return next;
}

export interface StepResult {
  action: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  screenshot?: string;
}

export interface ExecuteResult {
  status: 'success' | 'failed' | 'error';
  duration_ms: number;
  steps: StepResult[];
  screenshots: string[];
  error_message?: string;
  report_path?: string;
}

export interface ExecuteOptions {
  executedBy: string;
  environmentId?: number;
  deviceId?: number | string;
  /** Environment variables for ${varName} substitution in content/preconditions/checkpoints. */
  envVars?: Record<string, string>;
  // The owning user's id — used to load that user's Midscene model config
  // before each case so model / API key changes take effect immediately.
  userId?: number;
  // Identifying fields for the executing row — used to compute the report
  // path the same way web/pc executors do. Both default to undefined so the
  // report capture degrades gracefully (we just skip the file copy), but the
  // route layer always supplies them.
  caseId?: number | string;
  execId?: number | string;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2026-06-09: 远端设备 SSH 隧道辅助函数
//
// 设计原则: server 端"以为"是本地端口(127.0.0.1:random)实际是远端 adb/hdc/WDA。
// 对 Midscene 工厂函数零修改 — 它们接受 adb serial / hdc serial / WDA host:port,
// 我们让 server 的 adb 客户端、hdc 客户端、wda 客户端连到 127.0.0.1:tunnel_port。
//
// adb 客户端切端口: 走 ADB_SERVER_SOCKET=tcp:127.0.0.1:PORT env(adb 启动时会读)。
//   这个变量是 adb client 的标准,所有版本都认。@midscene/android 内部 spawn adb 子进程
//   时也会继承 env,所以这一行 export 之后整个 adb 链路全部走隧道。
//
// hdc 客户端切端口: hdc 用 HDC_SERVER_PORT 跟 ADB_SERVER_PORT 同样的语义(env var),
//   跟 adb 共用 5037 端口语义。hdc 启动时读这个 env,我们的 SSH 隧道也 5037。
//   注: 如果将来 hdc-server 用其他端口,改这一行就行,其它代码不用动。
//
// iOS WDA: WDA 本身不像 adb/hdc 有 server/client 模型,只是一个监听 8100 的 HTTP 服务。
//   @midscene/ios 的 agentFromWebDriverAgent({ wdaHost, wdaPort }) 显式接 host/port,
//   我们直接传 127.0.0.1:tunnelPort 即可。
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 把 device 行里加密的 SSH 凭据解密,组装出 SshCredsForTunnel。
 * 跟 agent-push/push.ts 的解密流程保持一致(都是 `decryptColumn('ssh_password', ...)`)。
 * 必填字段(ssh_host / ssh_user / ssh_auth_type)缺失 → 抛错让上层用错误信息提示用户。
 */
function sshCredsForDevice(device: DeviceRow): SshCredsForTunnel {
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    throw new Error(
      `Device ${device.id} missing SSH fields (host/user/auth_type) — fill in the device SSH settings first`,
    );
  }
  const password = device.ssh_auth_type === 'password'
    ? decryptColumn('ssh_password', device.ssh_password) ?? undefined
    : undefined;
  const privateKey = device.ssh_auth_type === 'private_key'
    ? decryptColumn('ssh_private_key', device.ssh_private_key) ?? undefined
    : undefined;
  return {
    host: device.ssh_host,
    port: device.ssh_port ?? 22,
    username: device.ssh_user,
    password,
    privateKey,
  };
}

/**
 * 给 adb 客户端设置"远端 adb-server"指向,所有后续 adb 调用都走 127.0.0.1:tunnelPort。
 * adb 子进程会读 ADB_SERVER_SOCKET env 决定连哪个 adb-server。
 */
function applyAdbServerEnv(localPort: number): void {
  process.env.ADB_SERVER_SOCKET = `tcp:127.0.0.1:${localPort}`;
  console.log(`[executor:mobile] ADB_SERVER_SOCKET=tcp:127.0.0.1:${localPort}`);
}

/**
 * 给 hdc 客户端设置"远端 hdc-server"指向,跟 adb 用相同的 5037 端口语义。
 * hdc 子进程读 HDC_SERVER_PORT 决定连哪个 hdc-server。
 * 注意: 远端 hdc-server 必须跟 adb-server 在同台机器 + 同样端口,否则要按设备行 metadata 区分。
 */
function applyHdcServerEnv(localPort: number): void {
  process.env.HDC_SERVER_PORT = String(localPort);
  console.log(`[executor:mobile] HDC_SERVER_PORT=${localPort}`);
}

/**
 * 远端 Android 设备 → 隧道 5037(adb-server 默认端口)。
 * 返回的 ActiveTunnel 上有 localPort,Midscene 走 agentFromAdbDevice(serial) 时
 * adb 客户端会先 connect ADB_SERVER_SOCKET 拿到设备列表,然后用 adb -s SERIAL 操作。
 */
async function openAdbSshTunnel(device: DeviceRow): Promise<ActiveTunnel> {
  console.log(`[executor:mobile] opening SSH tunnel for adb → device=${device.id} ssh=${device.ssh_host}:${device.ssh_port ?? 22}`);
  return openSshTunnel(
    { kind: 'new', creds: sshCredsForDevice(device) },
    { remoteHost: '127.0.0.1', remotePort: 5037 },
  );
}

/**
 * 远端 Harmony 设备 → 隧道 5037(hdc-server 默认端口,跟 adb 共用)。
 * 后续 hdc list targets 会通过 127.0.0.1:tunnelPort 拿到远端设备列表。
 */
async function openHarmonySshTunnel(device: DeviceRow): Promise<ActiveTunnel> {
  console.log(`[executor:mobile] opening SSH tunnel for hdc → device=${device.id} ssh=${device.ssh_host}:${device.ssh_port ?? 22}`);
  return openSshTunnel(
    { kind: 'new', creds: sshCredsForDevice(device) },
    { remoteHost: '127.0.0.1', remotePort: 5037 },
  );
}

/**
 * 远端 iOS 设备 → 隧道 8100(WDA 默认端口,mac 上跑 WDA 的 USB-connected 真机)。
 * @midscene/ios 的 agentFromWebDriverAgent({ wdaHost, wdaPort }) 显式接受这个组合,
 * 所以 iOS 这边不需要 env var,直接传 host/port 给 Midscene。
 */
async function openIosSshTunnel(device: DeviceRow): Promise<ActiveTunnel> {
  console.log(`[executor:mobile] opening SSH tunnel for iOS WDA → device=${device.id} ssh=${device.ssh_host}:${device.ssh_port ?? 22}`);
  return openSshTunnel(
    { kind: 'new', creds: sshCredsForDevice(device) },
    { remoteHost: '127.0.0.1', remotePort: 8100 },
  );
}

// Unified agent type for the post-2026-06-08 NL/YAML path. All three
// platforms expose `aiAct` / `runYaml` / `aiAssert` through PageAgent.
type AnyMobileAgent = AndroidAgent | IOSAgent | HarmonyAgent;

// 2026-06-10: copy a Midscene-generated report file from its temp location
// to the per-case stable path used by the report viewer. Mobile execution is
// always in-process (agent runs on the server, even for remote devices — we
// tunnel adb/hdc/WDA ports to localhost), so unlike web-executor we don't
// need a remote-pull path. Single file copy is sufficient because
// mobile-agent's `outputFormat: 'single-html'` produces a self-contained
// HTML report (no external screenshots/ directory to mirror).
async function copyMidsceneReport(
  sourcePath: string | null | undefined,
  targetPath: string
): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  try {
    await ensureReportDir(targetPath);
    await fs.copyFile(sourcePath, targetPath);
    console.log(`[executor:mobile] report copied: ${sourcePath} → ${targetPath}`);
    return targetPath;
  } catch (e) {
    console.log(`[executor:mobile] report copy FAILED: ${e instanceof Error ? e.message : String(e)} (src=${sourcePath} dst=${targetPath})`);
    return undefined;
  }
}

async function runCaseContent(
  agent: AnyMobileAgent,
  content: string,
  type: 'text' | 'yaml'
): Promise<StepResult> {
  const start = Date.now();
  const snippet = content.length > 60 ? content.slice(0, 60) + '...' : content;
  const label = type === 'yaml' ? `YAML: ${snippet}` : `AI 执行: ${snippet}`;
  try {
    if (type === 'yaml') {
      await agent.runYaml(content);
    } else {
      await agent.aiAct(content);
    }
    return { action: label, status: 'success', duration_ms: Date.now() - start };
  } catch (err) {
    return {
      action: label,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function executeMobileTest(
  testCase: MobileTestCaseRow,
  _opts: ExecuteOptions
): Promise<ExecuteResult> {
  const globalStart = Date.now();

  // 2026-06-10: compute the per-case Midscene report path up-front so we can
  // pass `generateReport: true` to all agent factories (so Midscene writes
  // its report) and copy that temp report to the stable path after the run.
  // Mirrors the web/pc executor pattern (see web-executor.ts:717-719).
  // caseId/execId are optional in the options interface so this function
  // remains unit-testable; the route layer always supplies them.
  const testType: TestType = 'mobile';
  const reportName = _opts.caseId != null && _opts.execId != null
    ? reportFileName(testType, _opts.caseId, _opts.execId)
    : undefined;
  const finalReportPath = _opts.caseId != null && _opts.execId != null
    ? generateReportPath(testType, _opts.caseId, _opts.execId, _opts.userId)
    : undefined;

  // Substitute ${varName} placeholders with environment variable values.
  const vars = _opts.envVars || {};

  console.log(`[executor:mobile] case=${testCase.id} start name="${testCase.name}" platform=${testCase.platform || 'android'} reportFileName=${reportName ?? '(skipped: no caseId/execId)'} reportPath=${finalReportPath ?? '(skipped)'} envVars=${Object.keys(vars).length} keys=${Object.keys(vars).join(',')}`);

  // 2026-06-08: case_content is the only executable path. Old `test_script`
  // JSON is kept on the row for historical log rendering but is not run.
  // Empty `case_content` AND empty `preconditions` → fail fast with a
  // clear "fill in the 用例内容 tab" message, so users hitting the 执行
  // button on a brand-new (unconfigured) case see why nothing happens.
  const rawCaseContent = (testCase.case_content || '').trim();
  const rawPreconditionText = resolvePreconditionText(testCase.preconditions);

  const caseContent = substituteVars(rawCaseContent, vars);
  const preconditionText = substituteVars(rawPreconditionText, vars);
  if (!caseContent && !preconditionText) {
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      screenshots: [],
      error_message: 'case_content is empty — please fill in the "用例内容" tab (natural language or YAML) before executing',
    };
  }
  if (!caseContent && preconditionText) {
    // Precondition alone is not enough to run; warn the user.
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: [],
      screenshots: [],
      error_message: 'case_content is empty — precondition alone cannot run a case. Fill in the "用例内容" tab.',
    };
  }

  // Push this user's Midscene model config (DB row → MIDSCENE_* env vars) so the
  // agent uses the user's chosen model / API key without restarting the server.
  if (_opts.userId) {
    try {
      await applyUserMidsceneConfig(_opts.userId, `case=${testCase.id} start`);
    } catch (e) {
      console.log(`[executor:mobile] case=${testCase.id} applyUserMidsceneConfig failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  let agent: AnyMobileAgent | null = null;
  let activeTunnel: ActiveTunnel | null = null;
  let reportPath: string | undefined;
  const platform = testCase.platform || 'android';

  // 2026-06-09: 远端设备 → SSH 隧道。deviceId 是 devices.id 时视为远端,
  // 走 SSH LocalForward;deviceId 是 local 字符串(`local:<platform>:<serial>`)
  // 或 undefined 时视为本地,直接调 agent factory。
  const deviceRow = typeof _opts.deviceId === 'number' ? getDevice(_opts.deviceId) : null;
  // 远端 = 设备行有 agent_endpoint(mobile-agent 上报过)
  const isRemote = !!deviceRow && deviceRow.test_type === 'mobile' && !!deviceRow.agent_endpoint;
  // 2026-06-20: 远程执行前校验设备状态
  if (isRemote && deviceRow!.status !== 'online') {
    throw new Error(`设备 ${deviceRow!.name} 当前状态为 ${deviceRow!.status}，无法远程执行（需要 agent 在线）`);
  }

  // 2026-06-10: report agent opts — same shape for all three platforms,
  // derived from the same fields. `generateReport: true` is the critical
  // bit: without it Midscene never writes `agent.reportFile` and the
  // post-run copy is a no-op. groupName/description show up in the report
  // header (e.g. "Mobile — open WeChat").
  const reportAgentOpt = reportName ? {
    generateReport: true,
    outputFormat: 'single-html' as const,
    reportFileName: reportName,
    groupName: testCase.name,
    groupDescription: testCase.description || undefined,
    ...getAgentOptOverrides(_opts.userId),
  } : { generateReport: false, ...getAgentOptOverrides(_opts.userId) };

  try {
    if (platform === 'ios') {
      if (isRemote && deviceRow) {
        // 远端 iOS: SSH 隧道 8100 → mac 上的 WDA,然后 agentFromWebDriverAgent
        // 直接用隧道端口。checkIOSEnvironment 是检查本地 WDA,远端时跳过。
        const tunnel = await openIosSshTunnel(deviceRow);
        activeTunnel = tunnel;
        // iOS opts are a single merged object: wdaHost/wdaPort from device
        // tunnel + report flags from generateReport path. Pass the merged
        // object as the first (and only) arg to agentFromWebDriverAgent.
        agent = await agentFromWebDriverAgent({
          wdaHost: '127.0.0.1',
          wdaPort: tunnel.localPort,
          ...reportAgentOpt,
        });
        console.log(`[executor:mobile] case=${testCase.id} iOS remote via SSH tunnel wdaHost=127.0.0.1 wdaPort=${tunnel.localPort} reportFileName=${reportName ?? '(skipped)'}`);
      } else {
        // 本地 iOS: 走 macOS server 上的 WDA(默认 8100)
        agent = await agentFromWebDriverAgent({ ...reportAgentOpt });
        console.log(`[executor:mobile] case=${testCase.id} iOS local (mac WDA) reportFileName=${reportName ?? '(skipped)'}`);
      }
    } else if (platform === 'harmony') {
      // @midscene/harmony: deviceId 是远端 hdc list targets -v 出来的 udid 字符串
      // 本地: undefined(让 midscene 用本机第一台);远端: deviceRow.serial
      if (isRemote && deviceRow) {
        agent = await withEnvMutex(async () => {
          const tunnel = await openHarmonySshTunnel(deviceRow);
          activeTunnel = tunnel;
          applyHdcServerEnv(tunnel.localPort);
          const a = await agentFromHdcDevice(deviceRow.serial || undefined, reportAgentOpt);
          console.log(`[executor:mobile] case=${testCase.id} harmony remote via SSH tunnel hdc localhost:${tunnel.localPort} serial=${deviceRow.serial} reportFileName=${reportName ?? '(skipped)'}`);
          return a;
        });
      } else {
        agent = await agentFromHdcDevice(deviceRow?.serial || undefined, reportAgentOpt);
      }
    } else {
      // android (default): @midscene/android — 走 adb 同样的 udid 形态
      if (isRemote && deviceRow) {
        agent = await withEnvMutex(async () => {
          const tunnel = await openAdbSshTunnel(deviceRow);
          activeTunnel = tunnel;
          applyAdbServerEnv(tunnel.localPort);
          const a = await agentFromAdbDevice(deviceRow.serial || undefined, reportAgentOpt);
          console.log(`[executor:mobile] case=${testCase.id} android remote via SSH tunnel adb localhost:${tunnel.localPort} serial=${deviceRow.serial} reportFileName=${reportName ?? '(skipped)'}`);
          return a;
        });
      } else {
        agent = await agentFromAdbDevice(deviceRow?.serial || undefined, reportAgentOpt);
      }
    }
    console.log(`[executor:mobile] case=${testCase.id} agent ready platform=${platform}`);

    // 2026-06-23: Auto-install linked app before running test actions.
    // If the case has an app_id, look up the app, resolve the version, and
    // install it on the target device. This runs before precondition so the
    // app is available when test steps execute.
    if (testCase.app_id) {
      const appUserId = testCase.user_id ?? _opts.userId;
      if (appUserId) {
        const app = findMobileAppById(testCase.app_id, appUserId);
        if (app) {
          const version = testCase.app_version || app.latest_version;
          if (version) {
            const versions: MobileAppVersion[] = JSON.parse(app.versions);
            const verInfo = versions.find(v => v.version === version);
            if (verInfo) {
              const appDir = path.resolve(PROJECT_ROOT, 'data', 'mobile-apps', String(app.id), version);
              const filePath = path.join(appDir, verInfo.filename);
              console.log(`[executor:mobile] case=${testCase.id} auto-install app="${app.name}" v${version} file=${filePath}`);
              const installStart = Date.now();
              try {
                const installResult = await installAppOnDevice({
                  filePath,
                  platform: (app.platform || platform) as 'android' | 'ios' | 'harmony',
                  serial: deviceRow?.serial || undefined,
                  device: isRemote ? deviceRow! : undefined,
                  isRemote,
                });
                const installMs = Date.now() - installStart;
                console.log(`[executor:mobile] case=${testCase.id} auto-install OK ${installMs}ms`);
                results.push({
                  action: `[安装] ${app.name} v${version}`,
                  status: 'success',
                  duration_ms: installMs,
                });
              } catch (installErr) {
                const installMs = Date.now() - installStart;
                const errMsg = installErr instanceof Error ? installErr.message : 'Unknown error';
                console.log(`[executor:mobile] case=${testCase.id} auto-install FAILED ${installMs}ms err="${errMsg}"`);
                results.push({
                  action: `[安装] ${app.name} v${version}`,
                  status: 'failed',
                  duration_ms: installMs,
                  error: errMsg,
                });
                if (finalReportPath && agent.reportFile) {
                  const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
                  if (copied) reportPath = copied;
                }
                return {
                  status: 'failed',
                  duration_ms: Date.now() - globalStart,
                  steps: results,
                  screenshots,
                  error_message: `应用安装失败: ${errMsg}`,
                  report_path: reportPath,
                };
              }
            } else {
              console.log(`[executor:mobile] case=${testCase.id} auto-install skipped: version "${version}" not found in app versions`);
            }
          } else {
            console.log(`[executor:mobile] case=${testCase.id} auto-install skipped: no version available`);
          }
        } else {
          console.log(`[executor:mobile] case=${testCase.id} auto-install skipped: app_id=${testCase.app_id} not found`);
        }
      }
    }

    // Precondition (optional): a single natural-language action that sets
    // up the desired state before the main case content runs.
    if (preconditionText) {
      const start = Date.now();
      console.log(`[executor:mobile] case=${testCase.id} precondition start text="${preconditionText.slice(0, 120)}"`);
      try {
        await agent.aiAct(preconditionText);
        const ms = Date.now() - start;
        console.log(`[executor:mobile] case=${testCase.id} precondition OK ${ms}ms`);
        results.push({
          action: `[前置] ${preconditionText}`,
          status: 'success',
          duration_ms: ms,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const ms = Date.now() - start;
        console.log(`[executor:mobile] case=${testCase.id} precondition FAILED ${ms}ms err="${errorMsg}"`);
        results.push({
          action: `[前置] ${preconditionText}`,
          status: 'failed',
          duration_ms: ms,
          error: errorMsg,
        });
        // 失败也复制报告 — 用户能从报告看到失败前的截图/状态,
        // 跟 web-executor 失败路径保持一致。
        if (finalReportPath && agent.reportFile) {
          const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
          if (copied) reportPath = copied;
        }
        return {
          status: 'failed',
          duration_ms: Date.now() - globalStart,
          steps: results,
          screenshots,
          error_message: `Precondition failed: ${errorMsg}`,
          report_path: reportPath,
        };
      }
    }

    // Main content: text → aiAct, yaml → runYaml.
    const type: 'text' | 'yaml' = testCase.case_content_type === 'yaml' ? 'yaml' : 'text';
    const preview = caseContent.slice(0, 120);
    console.log(`[executor:mobile] case=${testCase.id} content start type=${type} method=${type === 'yaml' ? 'runYaml' : 'aiAct'} preview="${preview}"`);
    const start = Date.now();
    const result = await runCaseContent(agent, caseContent, type);
    const ms = Date.now() - start;
    if (result.status === 'success') {
      console.log(`[executor:mobile] case=${testCase.id} content OK ${ms}ms`);
    } else {
      console.log(`[executor:mobile] case=${testCase.id} content ${result.status.toUpperCase()} ${ms}ms err="${result.error}"`);
    }
    results.push(result);
    if (result.status === 'failed') {
      // 失败也复制报告
      if (finalReportPath && agent.reportFile) {
        const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
        if (copied) reportPath = copied;
      }
      return {
        status: 'failed',
        duration_ms: Date.now() - globalStart,
        steps: results,
        screenshots,
        error_message: result.error,
        report_path: reportPath,
      };
    }

    // 成功路径: agent.aiAct 正常返回后,agent.reportFile 才有值

    // 2026-06-11: 执行自然语言断言 — 每条 TextAssertion 调一次 aiAssert,
    // 失败则整个用例标 failed。
    if (testCase.assertions) {
      try {
        const parsed = JSON.parse(testCase.assertions);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (entry && entry.type === 'text' && entry.text && entry.text.trim()) {
              const assertText = substituteVars(entry.text.trim(), vars);
              const assertStart = Date.now();
              const assertLabel = assertText.slice(0, 80);
              console.log(`[executor:mobile] case=${testCase.id} aiAssert start "${assertLabel}"`);
              try {
                await agent.aiAssert(assertText);
                const ms = Date.now() - assertStart;
                console.log(`[executor:mobile] case=${testCase.id} aiAssert OK ${ms}ms`);
                results.push({
                  action: `[断言] ${assertLabel}`,
                  status: 'success',
                  duration_ms: ms,
                });
              } catch (assertErr) {
                const ms = Date.now() - assertStart;
                const errMsg = assertErr instanceof Error ? assertErr.message : 'Unknown error';
                console.log(`[executor:mobile] case=${testCase.id} aiAssert FAILED ${ms}ms err="${errMsg}"`);
                results.push({
                  action: `[断言] ${assertLabel}`,
                  status: 'failed',
                  duration_ms: ms,
                  error: errMsg,
                });
                // 断言失败 → 整个用例 failed,但仍复制报告(用户能看到失败前的截图)
                if (finalReportPath && agent.reportFile) {
                  const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
                  if (copied) reportPath = copied;
                }
                return {
                  status: 'failed',
                  duration_ms: Date.now() - globalStart,
                  steps: results,
                  screenshots,
                  error_message: `断言失败: ${errMsg}`,
                  report_path: reportPath,
                };
              }
            }
          }
        }
      } catch {
        // assertions JSON 解析失败 — 跳过断言,不影响用例结果
        console.log(`[executor:mobile] case=${testCase.id} assertions JSON parse failed, skipping`);
      }
    }

    if (finalReportPath && agent.reportFile) {
      const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
      if (copied) reportPath = copied;
    }
    return {
      status: 'success',
      duration_ms: Date.now() - globalStart,
      steps: results,
      screenshots,
      report_path: reportPath,
    };
  } catch (err) {
    // 异常路径: agent 可能是 null(初始化就失败),也可能是 try 中途崩了;
    // 只有 agent 存在才尝试复制报告
    if (finalReportPath && agent?.reportFile) {
      const copied = await copyMidsceneReport(agent.reportFile, finalReportPath);
      if (copied) reportPath = copied;
    }
    return {
      status: 'error',
      duration_ms: Date.now() - globalStart,
      steps: results,
      screenshots,
      error_message: err instanceof Error ? err.message : 'Unknown error',
      report_path: reportPath,
    };
  } finally {
    if (agent) {
      await agent.destroy().catch(() => {});
    }
    // SSH 隧道: 跟 agent 独立生命周期 — 关掉本地端口释放 OS 资源,
    // 否则每跑一次远端设备用例就会留一个 LISTEN socket,时间长了撑爆端口范围。
    if (activeTunnel) {
      await activeTunnel.close().catch((e) => {
        console.log(`[executor:mobile] case=${testCase.id} ssh-tunnel close error: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
}
