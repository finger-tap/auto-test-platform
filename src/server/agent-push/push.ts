// 2026-06-07: orchestrator for "push agent to remote + restart via systemd".
//
// The high-level flow:
//   1. Build the gzipped tar bundle (bundler.createBundleStream).
//   2. Connect to the remote via SSH (ssh-client.connectSsh).
//   3. Upload the bundle to /tmp/agent-bundle-<ts>.tar.gz on the remote.
//   4. Run the inline deploy script via ssh-client.execCommand:
//      - extract to a temp dir
//      - verify sha256 (sha256sum -c bundle.sha256)
//      - atomically swap the new dir into /opt/auto-test-agent
//      - write /etc/auto-test-agent.env (idempotent)
//      - write the systemd unit (idempotent — only if not present)
//      - systemctl daemon-reload + enable + restart
//   5. Poll /healthz for up to 15s to confirm the agent came back online.
//      Healthz timeout = deploy failure (exit 1) — the agent must answer
//      /healthz before we mark the device online. systemd restart races
//      are absorbed by the 15s window; persistent failure means the
//      bundle/service/env is broken and the user must see it as offline.
//
// The deploy script is inlined as a template literal and sent via `bash -s`
// (stdin → heredoc). This avoids the round-trip of writing it to a file
// on the remote and then running it.
//
// Failure semantics: any error (connect, upload, exec non-zero) returns
// `{ ok: false, error: '...' }` and the caller (routes/devices.ts) writes
// the error to `devices.last_push_error` and the UI shows it.
//
// Time budget: SSH push can take a long time on large bundles or slow LANs.
// Do not add a broad wall-clock timeout here; each failing step should return
// its own concrete error as soon as it fails.

import { createBundleStream } from './bundler.js';
import { connectSsh, sftpUpload, execCommand } from './ssh-client.js';
import { decryptColumn } from './crypto.js';
import type { DeviceRow } from '../db/devices.js';
import { recordPushResult } from '../db/devices.js';
import type { Client as SshClient } from 'ssh2';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolveArch, resolveOs, nodeBinaryInstallPath, NODE_VERSION_MODERN, pickNodeVersionForGlibc, type TargetOs, type TargetArch } from './node-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * 2026-06-27: Bundler ships compiled .js (not .ts source), so we must run
 * the matching `build:agent*` script before each push. If the build fails
 * or the dist dir is missing afterward, push aborts with a clear error
 * rather than silently shipping a broken bundle that systemd can't start.
 */
function ensureAgentBuild(kind: 'web' | 'mobile' | 'pc'): void {
  const script = kind === 'mobile' ? 'build:agent-mobile'
    : kind === 'pc' ? 'build:agent-pc'
    : 'build:agent';
  const distDir = kind === 'mobile' ? 'agent-mobile'
    : kind === 'pc' ? 'agent-pc'
    : 'agent-web';
  const t0 = Date.now();
  console.log(`[agent-push] ensureAgentBuild kind=${kind} running npm run ${script} ...`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', script],
    { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const elapsed = Date.now() - t0;
  if (result.status !== 0) {
    const tail = (result.stdout || '') + (result.stderr || '');
    throw new Error(`npm run ${script} failed (exit=${result.status}): ${tail.slice(-800)}`);
  }
  // Sanity-check that the expected entry .js exists.
  const nested = kind === 'mobile' || kind === 'pc';
  const indexJs = nested
    ? path.join(PROJECT_ROOT, 'dist', distDir, distDir, 'index.js')
    : path.join(PROJECT_ROOT, 'dist', distDir, 'index.js');
  if (!existsSync(indexJs)) {
    throw new Error(`${script} succeeded but ${indexJs} not found; bundle would be broken`);
  }
  console.log(`[agent-push] ensureAgentBuild ok kind=${kind} entry=${indexJs} took=${elapsed}ms`);
}

const HEALTHZ_POLL_TIMEOUT_MS = 15_000;
const HEALTHZ_POLL_INTERVAL_MS = 1_000;
/** Max time to wait for bundle enumeration before aborting. */
const BUNDLE_READY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function normalizeServerUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return null;
  }
}

export function serverUrlForDevice(device: DeviceRow): string | null {
  return normalizeServerUrl(device.host);
}

export interface PushResult {
  ok: boolean;
  version?: string;
  took_ms: number;
  error?: string;
  bytes_uploaded?: number;
  /** combined stdout/stderr from the deploy script (for debugging) */
  deploy_log_tail?: string;
}

export interface PushProgressEvent {
  stage: 'bundling' | 'connecting' | 'uploading' | 'configuring' | 'deploying' | 'done' | 'error';
  message: string;
  percent?: number;
  bytes_uploaded?: number;
  total_bytes?: number;
}

export interface PushOptions {
  onProgress?: (event: PushProgressEvent) => void;
}

/**
 * The deploy script run on the remote. Designed to be idempotent: it
 * leaves the previous /opt/auto-test-agent in place until the new bundle
 * has been verified, then atomically swaps. Re-running it is safe.
 *
 * 2026-06-09: 把 "服务自启" 这段抽成 `__SERVICE_SETUP__` 占位符 — Linux 走
 * systemd(daemon-reload + enable + restart),macOS 走 launchd(load -w)。
 * 其它部分(解压/sha256 校验/原子 swap/healthz 探测)两边共享。
 *
 * IMPORTANT: keep this script single-quoted at the call site (`bash -s`)
 * so the local server doesn't expand the heredoc — we want the remote
 * bash to see the raw $BUNDLE_NEW, $sha256sum output, etc.
 */
const DEPLOY_SCRIPT = `set -e
TS=$(date +%s)
BUNDLE_PATH="/tmp/agent-bundle-\${TS}.tar.gz"
INSTALL_DIR="/opt/auto-test-agent"

echo "[deploy] moving bundle to $BUNDLE_PATH"
mv /tmp/agent-bundle-latest.tar.gz "$BUNDLE_PATH"

# 2026-06-27: 用户明确要求"用一个目录就行,别搞 new/old 这一套"。
# 之前用 -bundle-new + -old atomic swap 是为了部署中途失败时保护当前运行的
# 目录,但用户场景里部署失败就是失败,不需要 keep old。直接清空 /opt/auto-test-agent
# 重新解压,ExecStart 用这个固定路径,简单直观。
echo "[deploy] cleaning install dir $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "[deploy] extracting to $INSTALL_DIR"
tar -xzf "$BUNDLE_PATH" -C "$INSTALL_DIR"
rm -f "$BUNDLE_PATH"

echo "[deploy] verifying sha256"
cd "$INSTALL_DIR"
if ! sha256sum -c bundle.sha256 >/tmp/agent-bundle.sha256.log 2>&1; then
  echo "[deploy] sha256 verification FAILED, see /tmp/agent-bundle.sha256.log"
  exit 1
fi

echo "[deploy] verifying bundle contents before service start"
NODE_BIN="$INSTALL_DIR/node-runtime/bin/node"
ENTRY_JS="$INSTALL_DIR/__ENTRY_JS__"
if [ ! -x "$NODE_BIN" ]; then
  echo "[deploy] FAIL: node binary missing or not executable: $NODE_BIN"
  ls -la "$NODE_BIN" 2>&1
  ls -la $INSTALL_DIR/node-runtime/bin/ 2>&1 | head -10
  exit 1
fi
if [ ! -f "$ENTRY_JS" ]; then
  echo "[deploy] FAIL: entry js missing: $ENTRY_JS"
  find "$INSTALL_DIR" -maxdepth 4 -name 'index.js' 2>&1 | head -10
  exit 1
fi
NODE_VER=$("$NODE_BIN" --version 2>&1) || {
  echo "[deploy] FAIL: node binary cannot execute (exit $?) output=$NODE_VER"
  file "$NODE_BIN" 2>&1 || true
  ldd "$NODE_BIN" 2>&1 | head -10 || true
  exit 1
}
echo "[deploy] node version: $NODE_VER at $NODE_BIN"
echo "[deploy] entry js ok: $ENTRY_JS"
echo "[deploy] bundle verification ok"

echo "[deploy] setting up service"
__SERVICE_SETUP__

echo "[deploy] waiting for agent healthz"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  if curl -sf http://127.0.0.1:__HEALTHZ_PORT__/healthz >/dev/null 2>&1; then
    echo "[deploy] agent healthy after \${i}s"
    exit 0
  fi
done
echo "[deploy] WARNING: agent did not respond to /healthz within 15s — marking deploy as FAILED"
echo "[deploy] ---- diagnostic dump ----"
# Detect OS for appropriate service manager
if [ -d /Library/LaunchDaemons ]; then
  # macOS: use launchctl
  echo "[deploy] launchd plists:"
  ls -la /Library/LaunchDaemons/com.auto-test.*.plist 2>&1 | head -10
  for label in com.auto-test.agent com.auto-test.mobile-agent com.auto-test.pc-agent; do
    plist="/Library/LaunchDaemons/${label}.plist"
    if [ -f "$plist" ]; then
      echo "[deploy] === ${label} ==="
      launchctl list "$label" 2>&1 | head -5
      echo "[deploy] recent logs:"
      tail -20 /var/log/auto-test-agent.log 2>&1 | tail -10
    fi
  done
else
  # Linux: use systemctl
  echo "[deploy] auto-test-* units:"
  systemctl list-units --all 'auto-test-*' --no-pager --no-legend 2>&1 | head -10
  for u in auto-test-agent auto-test-mobile-agent auto-test-pc-agent; do
    if systemctl cat "$u.service" >/dev/null 2>&1; then
      echo "[deploy] === $u.service status ==="
      systemctl status "$u.service" --no-pager -n 15 2>&1
      echo "[deploy] === $u.service journal (last 25 lines) ==="
      journalctl -u "$u.service" -n 25 --no-pager 2>&1 | tail -30
    fi
  done
fi
echo "[deploy] node binary listing:"
ls -la /opt/auto-test-agent/node-runtime/bin/ 2>&1 | head -10
echo "[deploy] entry candidates:"
ls -la /opt/auto-test-agent/agent-src/index.js 2>&1
ls -la /opt/auto-test-agent/mobile-agent-src/index.js 2>&1
ls -la /opt/auto-test-agent/pc-agent-src/agent-pc/index.js 2>&1
echo "[deploy] node --version:"
/opt/auto-test-agent/node-runtime/bin/node --version 2>&1 || echo "[deploy] node binary execution failed (exit $?)"
echo "[deploy] ---- end diagnostic ----"
exit 1
`;

/**
 * Linux (systemd) 服务自启段:daemon-reload + enable + restart。
 * enable 失败不阻 restart(老机器可能没 enable,只是手动跑过)。
 */
const SERVICE_SETUP_LINUX = `systemctl daemon-reload
systemctl enable __UNIT_NAME__ 2>/dev/null || true
systemctl restart __UNIT_NAME__`;

/**
 * 2026-06-09: macOS (launchd) 服务自启段。
 * - launchd 没有 daemon-reload,改了 plist 直接 load -w 即可
 * - 改 plist 之前先 unload,避免 macOS 报 "service already bootstrapped"
 * - 日志走 /var/log/auto-test-agent.log,需要先 touch + chmod 666
 *   (launchd 以 root 跑,其它用户读 tail -f)
 */
const SERVICE_SETUP_MACOS = `PLIST_PATH="/Library/LaunchDaemons/__PLIST_LABEL__.plist"
sudo touch /var/log/auto-test-agent.log
sudo chmod 666 /var/log/auto-test-agent.log
sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
sudo launchctl load -w "$PLIST_PATH"`;

/**
 * 2026-06-27: Windows (sc.exe / Windows Service) 服务自启段。
 * - 用 New-Service 创建服务(New-Service 自动处理 binPath 引号转义,比
 *   sc.exe 直接调用更稳)
 * - 已存在同名服务先 stop + delete(idempotent)
 * - sc.exe failure 配置失败自动重启(reset= 0 表示失败计数不重置;actions=
 *   restart/1000/... 表示三次失败各间隔 1s 重启)
 * - Start-Service 启动
 *
 * 占位符:
 *   __SERVICE_NAME__ → auto-test-agent / auto-test-mobile-agent / auto-test-pc-agent
 *   __NODE_BIN__     → C:\auto-test-agent\node-runtime\node.exe
 *   __ENTRY_JS__     → C:\auto-test-agent\agent-src\index.js (or nested for mobile/pc)
 */
const SERVICE_SETUP_WIN = `$svc = '__SERVICE_NAME__'
$bin = '"__NODE_BIN__" "__ENTRY_JS__"'
if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
  Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  sc.exe delete $svc | Out-Null
}
New-Service -Name $svc -BinaryPathName $bin -StartupType Automatic | Out-Null
sc.exe failure $svc reset= 0 actions= restart/1000/restart/1000/restart/1000 | Out-Null
Start-Service -Name $svc`;

/**
 * 2026-06-27: Windows deploy 脚本(PowerShell,通过 `powershell -NoProfile
 * -NonInteractive -Command -` 走 stdin)。
 *
 * 跟 Linux/Mac deploy 流程对应:
 *   1. 把上传的 bundle 重命名带时间戳
 *   2. 解压(Win10+ 自带 tar.exe = bsdtar,跨平台格式;不支持的环境 fallback
 *      到 Expand-Archive,但 Expand-Archive 不认 .tar.gz,要先 tar 解 tar
 *      再 zip 解 — 实际很少见,直接报错)
 *   3. SHA256 校验(Get-FileHash,bundle.sha256 是 sha256sum -c 格式,
 *      逐行解析)
 *   4. 原子 swap(旧目录 rename 成 -old,新目录 rename 成 install root)
 *   5. SERVICE_SETUP_WIN 占位符替换后注入
 *   6. healthz 轮询(Invoke-WebRequest)
 *
 * 占位符:
 *   __HEALTHZ_PORT__  → agent port
 *   __SERVICE_SETUP__ → SERVICE_SETUP_WIN 替换后内容
 */
const DEPLOY_SCRIPT_WIN = `$ErrorActionPreference = 'Stop'
$TS = [int64](Get-Date -UFormat %s)
$BundlePath = "C:\\Windows\\Temp\\agent-bundle-$TS.tar.gz"
$InstallRoot = "C:\\auto-test-agent"

Write-Host "[deploy] moving bundle to $BundlePath"
Move-Item "C:\\Windows\\Temp\\agent-bundle-latest.tar.gz" $BundlePath -Force

# 2026-06-27: 用户明确要求"用一个目录就行,别搞 new/old 这一套"。
# 直接清空 InstallRoot 重新解压,sc.exe 服务 binPath 用这个固定路径。
Write-Host "[deploy] cleaning install dir $InstallRoot"
if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null

Write-Host "[deploy] extracting to $InstallRoot"
# Win10+ 自带 tar.exe (bsdtar)。老 Win Server 没有,会走 catch 报错。
$tarExit = & tar.exe -xzf $BundlePath -C $InstallRoot 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "[deploy] tar.exe failed (exit=$LASTEXITCODE): $tarExit"
  Write-Host "[deploy] hint: install 'Git for Windows' or '7-zip' on the remote, or upgrade to Win10 1803+"
  exit 1
}
Remove-Item $BundlePath -Force

Write-Host "[deploy] verifying sha256"
Push-Location $InstallRoot
$manifest = Get-Content -Path 'bundle.sha256' -ErrorAction Stop
foreach ($line in $manifest) {
  if ($line -match '^([0-9a-f]+)\\s+\\*?(.+)$') {
    $expected = $matches[1]
    $file = $matches[2] -replace '/', '\\'
    if (-not (Test-Path $file)) { Write-Host "[deploy] sha256 missing file: $file"; Pop-Location; exit 1 }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
    if ($actual -ne $expected) {
      Write-Host "[deploy] sha256 mismatch for $file"
      Write-Host "[deploy]   expected=$expected"
      Write-Host "[deploy]   actual=  $actual"
      Pop-Location; exit 1
    }
  }
}
Pop-Location

Write-Host "[deploy] verifying bundle contents before service start"
$NodeBin = "$InstallRoot\\node-runtime\\node.exe"
$EntryJs = ("$InstallRoot\\__ENTRY_JS__").Replace('/', '\\')
if (-not (Test-Path $NodeBin)) {
  Write-Host "[deploy] FAIL: node.exe missing: $NodeBin"
  Get-ChildItem "$InstallRoot\\node-runtime\\" -ErrorAction SilentlyContinue | Select-Object -First 10
  exit 1
}
if (-not (Test-Path $EntryJs)) {
  Write-Host "[deploy] FAIL: entry js missing: $EntryJs"
  Get-ChildItem -Recurse "$InstallRoot\\" -Filter 'index.js' -ErrorAction SilentlyContinue | Select-Object -First 10
  exit 1
}
$NodeVer = & $NodeBin --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "[deploy] FAIL: node.exe cannot execute (exit $LASTEXITCODE) output=$NodeVer"
  exit 1
}
Write-Host "[deploy] node version: $NodeVer at $NodeBin"
Write-Host "[deploy] entry js ok: $EntryJs"
Write-Host "[deploy] bundle verification ok"

Write-Host "[deploy] setting up service"
__SERVICE_SETUP__

Write-Host "[deploy] waiting for agent healthz"
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:__HEALTHZ_PORT__/healthz" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) {
      Write-Host "[deploy] agent healthy after \${i}s"
      exit 0
    }
  } catch {}
}
Write-Host "[deploy] WARNING: agent did not respond to /healthz within 15s — marking deploy as FAILED"
exit 1
`;

export async function pushAgent(device: DeviceRow, options: PushOptions = {}): Promise<PushResult> {
  return pushAgentByKind(device, 'web', options);
}

/**
 * 2026-06-08: 远端 mobile-agent 推送 — 跟 web-agent 共用同一份 bundle
 * (mobile-agent-src/ 也打在 bundle 里),但 systemd unit 名 / port / entry 都不同。
 */
export async function pushMobileAgent(device: DeviceRow, options: PushOptions = {}): Promise<PushResult> {
  return pushAgentByKind(device, 'mobile', options);
}

async function pushAgentByKind(device: DeviceRow, kind: 'web' | 'mobile' | 'pc', options: PushOptions): Promise<PushResult> {
  const t0 = Date.now();
  const { id, name, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, agent_token, os_type } = device;
  const serverUrl = serverUrlForDevice(device);
  // mobile-agent 部署到 device.mobile_agent_port(默认 4002)
  // pc-agent 部署到 device.pc_agent_port(默认 4003)
  const agentPort = kind === 'mobile'
    ? (device.mobile_agent_port ?? 4002)
    : kind === 'pc'
      ? 4003  // pc-agent 固定端口,与 web(4001)/mobile(4002) 并列
      : 4001;
  const unitName = kind === 'mobile' ? 'auto-test-mobile-agent.service'
    : kind === 'pc' ? 'auto-test-pc-agent.service'
    : 'auto-test-agent.service';
  const plistLabel = kind === 'mobile' ? 'com.auto-test.mobile-agent'
    : kind === 'pc' ? 'com.auto-test.pc-agent'
    : 'com.auto-test.agent';
  // 2026-06-27: web bundle is flat (tsconfig.agent.json rootDir=src/agent-web),
  // so agent-src/index.js lands at the top of the bundle. mobile/pc bundles
  // re-export from agent-web, so their tsconfigs use rootDir=src and the
  // compiled output nests: dist/agent-X/agent-X/index.js.
  // 2026-06-28: bundler now points MOBILE_AGENT_DIST to the inner directory,
  // so mobile-agent-src/index.js is at the top level (no nesting).
  const entryPoint = kind === 'mobile' ? 'mobile-agent-src/index.js'
    : kind === 'pc' ? 'pc-agent-src/agent-pc/index.js'
    : 'agent-src/index.js';

  // 2026-06-27: 远端 OS 决定 systemd(Linux) / launchd(macOS) / sc.exe(Windows)。
  // os_type 为空 → 兜底 Linux(老数据,UI 上没填)。
  const effectiveOs: 'linux' | 'macos' | 'windows' =
    os_type === 'macos' ? 'macos' : os_type === 'windows' ? 'windows' : 'linux';

  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, took_ms: 0, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux' && os_type !== 'macos' && os_type !== 'windows') {
    return { ok: false, took_ms: 0, error: `OS "${os_type}" is not supported (only linux / macos / windows)` };
  }
  if (!agent_token) {
    return { ok: false, took_ms: 0, error: 'Device has no agent_token' };
  }
  if (!serverUrl) {
    return { ok: false, took_ms: 0, error: 'Device host is not configured; cannot compose agent .env. Set device host to the platform URL, e.g. http://192.168.127.1:3000' };
  }

  const plaintextPassword = ssh_auth_type === 'password' ? decryptColumn('ssh_password', ssh_password) : null;
  const plaintextKey = ssh_auth_type === 'private_key' ? decryptColumn('ssh_private_key', ssh_private_key) : null;
  if (ssh_auth_type === 'password' && !plaintextPassword) {
    return { ok: false, took_ms: 0, error: 'SSH 密码无法解密，请编辑设备重新输入密码后再上线（可能是本地加密密钥变化或旧数据损坏）' };
  }
  if (ssh_auth_type === 'private_key' && !plaintextKey) {
    return { ok: false, took_ms: 0, error: 'SSH 私钥无法解密，请编辑设备重新输入私钥后再上线（可能是本地加密密钥变化或旧数据损坏）' };
  }

  console.log(`[agent-push] pushAgentByKind start kind=${kind} device=${id} name="${name}" ssh=${ssh_user}@${ssh_host}:${ssh_port ?? 22} os=${effectiveOs}`);

  // 2026-06-27: build the matching agent *before* SSH connect — if the build
  // fails, surface the error immediately without holding an SSH session open.
  try {
    ensureAgentBuild(kind);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent-push] ensureAgentBuild FAILED kind=${kind} device=${id}: ${msg}`);
    return { ok: false, took_ms: 0, error: `agent 构建失败: ${msg}` };
  }

  let bytesUploaded = 0;
  let sshConn: { conn: SshClient; end: () => void } | null = null;
  let bundleRef: ReturnType<typeof createBundleStream> | null = null;
  const emitProgress = (event: PushProgressEvent) => options.onProgress?.(event);

  emitProgress({ stage: 'connecting', message: '正在连接执行机', percent: 3 });

  const pushWork = (async () => {
    try {
      // 1. Connect SSH FIRST — before creating the bundle stream — so the
      //    gzip output has a consumer (SFTP) from the first byte. If we
      //    create the bundle first, the gzip buffer fills up with no reader
      //    and the event loop stalls on IO backpressure.
      console.log(`[agent-push] connecting SSH ${ssh_user}@${ssh_host}:${ssh_port ?? 22} auth=${ssh_auth_type} ...`);
      sshConn = await connectSsh({
        host: ssh_host,
        port: ssh_port ?? 22,
        username: ssh_user,
        password: plaintextPassword ?? undefined,
        privateKey: plaintextKey ?? undefined,
      });
      console.log(`[agent-push] ssh connected to ${ssh_user}@${ssh_host}:${ssh_port ?? 22}`);
      emitProgress({ stage: 'bundling', message: '已连接，正在打包推送包', percent: 5 });

      // 2026-06-27: 探测远端 arch,给 bundler 选匹配的 prebuilt node。
      // Linux/macOS 跑 uname -m;Windows 没 uname,用 cmd %PROCESSOR_ARCHITECTURE%。
      // 失败 → 推送直接 fail,避免推一个跑不起来的 bundle。
      const targetOs: TargetOs = effectiveOs === 'macos' ? 'darwin' : effectiveOs === 'windows' ? 'win' : 'linux';
      const archCmd = effectiveOs === 'windows'
        ? 'powershell -NoProfile -Command "$env:PROCESSOR_ARCHITECTURE"'
        : 'uname -m';
      const detectRes = await execCommand(sshConn.conn, archCmd, 'detect-arch');
      const archRaw = (detectRes.stdout || '').trim();
      const targetArch: TargetArch | null = resolveArch(archRaw);
      if (!targetArch) {
        throw new Error(`unsupported remote arch "${archRaw}" (${archCmd}); bundler has no matching prebuilt node`);
      }
      console.log(`[agent-push] remote os=${targetOs} arch=${targetArch} (raw=${archRaw})`);

      // 2026-06-27: 探测远端 glibc 版本,选 Node 版本。
      //   glibc >= 2.28 → modern (v24,跟本机一致)
      //   glibc <  2.28 → legacy (v18,Node 18 是最后兼容 CentOS 7 的 LTS)
      // macOS/Windows 没 glibc,直接用 modern。
      let nodeVersion: string;
      if (effectiveOs === 'linux') {
        const glibcRes = await execCommand(sshConn.conn, 'ldd --version | head -1', 'detect-glibc');
        const glibcRaw = (glibcRes.stdout || '').trim();
        nodeVersion = pickNodeVersionForGlibc(glibcRaw);
        console.log(`[agent-push] remote glibc raw="${glibcRaw}" → node ${nodeVersion}`);
      } else {
        nodeVersion = NODE_VERSION_MODERN;
        console.log(`[agent-push] non-linux os=${targetOs}, using node ${nodeVersion}`);
      }

      // 2. Create bundle stream AFTER SSH is ready — the gzip output will
      //    be piped directly to SFTP, keeping the buffer drained.
      // browsers: 只有 web 类型需要 chromium，mobile/pc 不需要。
      // adbRuntime: 只有 mobile 类型需要 adb。
      const bundle = createBundleStream(kind, {
        nodeRuntime: { os: targetOs, arch: targetArch, version: nodeVersion },
        browsers: kind === 'web' ? { os: targetOs, arch: targetArch } : undefined,
        adbRuntime: kind === 'mobile' ? targetOs : undefined,
        onEnumerateProgress: ({ phase, files, dirs }) => {
          console.log(`[agent-push] bundler enumerate progress kind=${kind} device=${id} phase=${phase} files=${files} dirs=${dirs}`);
        },
      });
      bundleRef = bundle;

      console.log(`[agent-push] awaiting bundle.ready kind=${kind} device=${id} (timeout=${BUNDLE_READY_TIMEOUT_MS / 1000}s) ...`);
      const meta = await Promise.race([
        bundle.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Bundle enumeration timed out after ${BUNDLE_READY_TIMEOUT_MS / 1000}s — node_modules or browsers dir may be too large or unreachable`)), BUNDLE_READY_TIMEOUT_MS)
        ),
      ]);
      console.log(`[agent-push] bundle.ready kind=${kind} device=${id} version=${meta.version} files=${meta.fileCount} totalBytes=${meta.totalBytes}`);
      // 2026-06-27: Win install root = C:\auto-test-agent, Linux/macOS = /opt/auto-test-agent。
      // SFTP upload path:Win 上 forward slash 也 OK(ssh2 / OpenSSH 都接受),走 C:/Windows/Temp。
      const remoteRoot = effectiveOs === 'windows' ? 'C:\\auto-test-agent' : '/opt/auto-test-agent';
      const remotePath = effectiveOs === 'windows'
        ? 'C:/Windows/Temp/agent-bundle-latest.tar.gz'
        : '/tmp/agent-bundle-latest.tar.gz';
      const serviceName = effectiveOs === 'macos' ? plistLabel
        : effectiveOs === 'windows' ? unitName  // Win service name 跟 systemd unit 同名(auto-test-agent / mobile / pc)
        : unitName;
      console.log(`[agent-push] start kind=${kind} device=${id} name="${name}" host=${ssh_user}@${ssh_host}:${ssh_port ?? 22} os=${effectiveOs} package=agent-bundle-${meta.version}.tar.gz files=${meta.fileCount} size=${(meta.totalBytes / 1024 / 1024).toFixed(1)}MB upload=${remotePath} install=${remoteRoot} service=${serviceName}`);
      emitProgress({ stage: 'uploading', message: '正在上传推送包', percent: 10, bytes_uploaded: 0, total_bytes: meta.totalBytes });

      // 3. Upload to /tmp/agent-bundle-latest.tar.gz (deploy script renames
      //    it to a timestamped name so concurrent pushes don't collide).
      console.log(`[agent-push] starting SFTP upload kind=${kind} device=${id} remote=${remotePath} bundleSize=${(meta.totalBytes / 1024 / 1024).toFixed(1)}MB ...`);
      const tUpload = Date.now();
      await sftpUpload(sshConn.conn, remotePath, bundle.stream, (b) => {
        bytesUploaded = b;
        const uploadRatio = meta.totalBytes > 0 ? Math.min(b / meta.totalBytes, 1) : 0;
        emitProgress({
          stage: 'uploading',
          message: `正在上传推送包 ${Math.round(uploadRatio * 100)}%`,
          percent: Math.round(10 + uploadRatio * 70),
          bytes_uploaded: b,
          total_bytes: meta.totalBytes,
        });
      });
      console.log(`[agent-push] upload ok device=${id} remote=${remotePath} bytes=${bytesUploaded} took=${Date.now() - tUpload}ms`);
      emitProgress({ stage: 'configuring', message: '上传完成，正在写入远端配置', percent: 82, bytes_uploaded: bytesUploaded, total_bytes: meta.totalBytes });

      // 2. 写 env + service 定义。三种 OS 分支:
      //    - Linux: bash heredoc 写 /etc/auto-test-agent.env + systemd unit
      //    - macOS: bash heredoc 写 .env + launchd plist(env 也 inline 到 plist)
      //    - Windows: PowerShell [Environment]::SetEnvironmentVariable 'Machine';
      //               service 定义不需要单独文件,sc.exe 在 deploy 脚本里 inline 创建
      const safeName = name.replace(/\s+/g, '-').slice(0, 32);
      const browsersPath = effectiveOs === 'windows' ? 'C:\\auto-test-agent\\browsers' : '/opt/auto-test-agent/browsers';
      const envPairs: Array<[string, string]> = [
        ['AGENT_TOKEN', agent_token],
        ['AGENT_SERVER_URL', serverUrl || ''],
        ['AGENT_NAME', safeName],
        ['AGENT_PORT', String(agentPort)],
        ['AGENT_BROWSERS_PATH', browsersPath],
        ...(kind === 'mobile' ? ([['AGENT_MOBILE_PORT', String(agentPort)]] as Array<[string, string]>) : []),
        ...(kind === 'pc' ? ([['AGENT_PC_PORT', String(agentPort)]] as Array<[string, string]>) : []),
      ];

      if (effectiveOs === 'windows') {
        // PowerShell set machine-level env vars. SSH user must be admin.
        // Single-quoted values to prevent injection; embedded ' escaped as ''.
        const psLines = envPairs.map(([k, v]) => {
          const safeVal = (v || '').replace(/'/g, "''");
          return `[Environment]::SetEnvironmentVariable('${k}', '${safeVal}', 'Machine')`;
        });
        const psScript = psLines.join('\n');
        const envRes = await execCommand(
          sshConn.conn,
          'powershell -NoProfile -NonInteractive -Command -',
          'write-env-win',
          psScript + '\n',
        );
        if (envRes.code !== 0) {
          throw new Error(`write env (windows) failed: ${envRes.stderr.slice(-500)}`);
        }
        console.log(`[agent-push] env ok (win machine-level) device=${id} pairs=${envPairs.length}`);
      } else {
        const envContent = envPairs.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
        const envPath = '/etc/auto-test-agent.env';
        const writeEnvCmd = `echo ${shellQuote(envContent)} | sudo tee ${envPath} >/dev/null && sudo chmod 600 ${envPath}`;
        const envRes = await execCommand(sshConn.conn, writeEnvCmd, 'write-env');
        if (envRes.code !== 0) {
          throw new Error(`write env file failed: ${envRes.stderr.slice(-500)}`);
        }
        console.log(`[agent-push] env ok device=${id} remote=${envPath} port=${agentPort} server=${serverUrl}`);
      }
      emitProgress({ stage: 'configuring', message: '配置已写入，正在准备服务定义', percent: 86, bytes_uploaded: bytesUploaded, total_bytes: meta.totalBytes });

      // 3. 写 service 定义 — Linux = systemd unit,macOS = launchd plist,Windows = 跳过(sc.exe 在 deploy 里 inline)
      if (effectiveOs === 'macos') {
        const plistPath = `/Library/LaunchDaemons/${plistLabel}.plist`;
        const plistText = plistContent({
          label: plistLabel,
          token: agent_token,
          serverUrl: serverUrl || '',
          deviceName: name,
          agentPort,
          entryPoint,
          kind,
        });
        // 2026-06-27: 之前 `if [ ! -f ${plistPath} ]` 保护用户手改,但 upgrade
        // 路径(node 路径变 / entry 变)需要 plist 跟着覆盖,否则老 ProgramArguments
        // 永远留在磁盘上。launchd plist 是系统自动管理产物,强制覆盖。
        const writePlistCmd = `sudo tee ${plistPath} >/dev/null <<PLIST_EOF
${plistText}
PLIST_EOF
sudo chmod 644 ${plistPath}`;
        const plistRes = await execCommand(sshConn.conn, writePlistCmd, 'write-plist');
        if (plistRes.code !== 0) {
          throw new Error(`write launchd plist failed: ${plistRes.stderr.slice(-500)}`);
        }
        console.log(`[agent-push] service file ok device=${id} remote=${plistPath}`);
      } else if (effectiveOs === 'linux') {
        const unitContent = systemdUnitContent(agent_token, serverUrl || '', name, entryPoint);
        const unitPath = `/etc/systemd/system/${unitName}`;
        // 2026-06-27: 之前用 `if [ ! -f ${unitPath} ]; then ... fi' 保护用户手改,
        // 但实际场景是 bundle 升级 / node 路径变更 / entry 路径变更 → unit 文件必须
        // 跟着覆盖,否则老的 ExecStart(如 /usr/bin/node)永远留在磁盘上,
        // systemctl restart 读的还是旧文件。systemd unit 是系统自动管理产物,
        // 用户手改概率极低,强制覆盖。
        const writeUnitCmd = `sudo tee ${unitPath} >/dev/null <<UNIT_EOF
${unitContent}
UNIT_EOF`;
        const unitRes = await execCommand(sshConn.conn, writeUnitCmd, 'write-unit');
        if (unitRes.code !== 0) {
          throw new Error(`write systemd unit failed: ${unitRes.stderr.slice(-500)}`);
        }
        console.log(`[agent-push] service file ok device=${id} remote=${unitPath}`);
      } else {
        // windows: nothing to write here — sc.exe create runs inside DEPLOY_SCRIPT_WIN.
        console.log(`[agent-push] windows: service registration deferred to deploy script device=${id}`);
      }

      // 4. Run the deploy script (extract, verify, swap, restart).
      //    占位符按 OS 替换:
      //      __HEALTHZ_PORT__   → agent listen 端口
      //      __SERVICE_SETUP__  → linux: systemctl; macos: launchctl; win: sc.exe
      //      __UNIT_NAME__      → systemd unit name (linux)
      //      __PLIST_LABEL__    → launchd plist label (macos)
      //      __SERVICE_NAME__   → windows service name (sc.exe)
      //      __NODE_BIN__       → windows bundle 内 node.exe 路径
      //      __ENTRY_JS__       → windows bundle 内 entry .js 路径
      const healthzPort = agentPort;
      const winNodeBin = 'C:\\auto-test-agent\\node-runtime\\node.exe';
      const winEntryJs = 'C:\\auto-test-agent\\' + entryPoint.replace(/\//g, '\\');
      const serviceSetup = (effectiveOs === 'windows' ? SERVICE_SETUP_WIN
        : effectiveOs === 'macos' ? SERVICE_SETUP_MACOS
        : SERVICE_SETUP_LINUX)
        .replace(/__UNIT_NAME__/g, unitName)
        .replace(/__PLIST_LABEL__/g, plistLabel)
        .replace(/__SERVICE_NAME__/g, unitName)
        .replace(/__NODE_BIN__/g, winNodeBin)
        .replace(/__ENTRY_JS__/g, winEntryJs);
      const deployTemplate = effectiveOs === 'windows' ? DEPLOY_SCRIPT_WIN : DEPLOY_SCRIPT;
      const deployScriptFor = deployTemplate
        .replace(/__HEALTHZ_PORT__/g, String(healthzPort))
        .replace(/__SERVICE_SETUP__/g, serviceSetup)
        .replace(/__ENTRY_JS__/g, entryPoint);
      console.log(`[agent-push] deploy starting device=${id} install=${remoteRoot} service=${serviceName} healthz=http://127.0.0.1:${healthzPort}/healthz`);
      emitProgress({ stage: 'deploying', message: '正在部署并重启 agent', percent: 92, bytes_uploaded: bytesUploaded, total_bytes: meta.totalBytes });
      let deployRes: { stdout: string; stderr: string; code: number | null; signal: string | null };
      if (effectiveOs === 'windows') {
        console.log(`[agent-push] executing deploy script via powershell -Command - on device=${id} ...`);
        deployRes = await execCommand(
          sshConn.conn,
          'powershell -NoProfile -NonInteractive -Command -',
          'deploy-win',
          deployScriptFor + '\n',
        );
      } else {
        console.log(`[agent-push] executing deploy script via sudo bash -s on device=${id} ...`);
        deployRes = await execCommand(sshConn.conn, `sudo bash -s <<'DEPLOY_EOF'\n${deployScriptFor}\nDEPLOY_EOF`, 'deploy');
      }
      const logTail = (deployRes.stdout + deployRes.stderr).slice(-2000);
      if (deployRes.code !== 0) {
        throw new Error(`deploy script failed (code=${deployRes.code}): ${logTail}`);
      }

      const took = Date.now() - t0;
      console.log(`[agent-push] deploy result device=${id} service=${serviceName} code=${deployRes.code} logTail=${JSON.stringify(logTail.slice(-800))}`);
      console.log(`[agent-push] push ok kind=${kind} device=${id} version=${meta.version} bytes=${bytesUploaded} install=${remoteRoot} service=${serviceName} took=${took}ms`);
      recordPushResult(id, 'ok');
      emitProgress({ stage: 'done', message: '上线完成', percent: 100, bytes_uploaded: bytesUploaded, total_bytes: meta.totalBytes });
      return {
        ok: true,
        version: meta.version,
        took_ms: took,
        bytes_uploaded: bytesUploaded,
        deploy_log_tail: logTail,
      } as PushResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      console.error(`[agent-push] push failed kind=${kind} device=${id}: ${msg}`);
      if (stack) console.error(`[agent-push] stack: ${stack}`);
      recordPushResult(id, 'error', msg);
      emitProgress({ stage: 'error', message: msg, percent: undefined, bytes_uploaded: bytesUploaded });
      return { ok: false, took_ms: Date.now() - t0, error: msg } as PushResult;
    } finally {
      try { bundleRef?.stream.destroy(); } catch { /* ignore */ }
      try { sshConn?.end(); } catch { /* ignore */ }
    }
  })();

  return pushWork;
}

/**
 * Stop a remote agent by running `systemctl stop` on its machine.
 * Used by the UI's "停止" button. Doesn't remove the unit — the user
 * can restart by clicking "重连/升级" or manually.
 *
 * 2026-06-08: 加 kind 参数区分 web-agent (auto-test-agent.service)
 * vs mobile-agent (auto-test-mobile-agent.service)。
 */
export async function stopAgent(
  device: DeviceRow,
  kind: 'web' | 'mobile' | 'pc' = 'web',
): Promise<{ ok: boolean; error?: string }> {
  const { id, name, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = device;
  const effectiveOs: 'linux' | 'macos' | 'windows' =
    os_type === 'macos' ? 'macos' : os_type === 'windows' ? 'windows' : 'linux';

  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux' && os_type !== 'macos' && os_type !== 'windows') {
    return { ok: false, error: `OS "${os_type}" is not supported` };
  }

  const plaintextPassword = ssh_auth_type === 'password' ? decryptColumn('ssh_password', ssh_password) : null;
  const plaintextKey = ssh_auth_type === 'private_key' ? decryptColumn('ssh_private_key', ssh_private_key) : null;
  if (ssh_auth_type === 'password' && !plaintextPassword) {
    return { ok: false, error: 'SSH 密码无法解密，请编辑设备重新输入密码后再下线（可能是本地加密密钥变化或旧数据损坏）' };
  }
  if (ssh_auth_type === 'private_key' && !plaintextKey) {
    return { ok: false, error: 'SSH 私钥无法解密，请编辑设备重新输入私钥后再下线（可能是本地加密密钥变化或旧数据损坏）' };
  }

  const unitName = kind === 'mobile' ? 'auto-test-mobile-agent.service'
    : kind === 'pc' ? 'auto-test-pc-agent.service'
    : 'auto-test-agent.service';
  // 2026-06-15: 跟 pushAgentByKind 的 plistLabel 对齐 — 之前 stop 路径漏了
  // pc 分支,会让 macOS 上停 PC agent 时 unload 错误的 plist(web 的)。
  const plistLabel = kind === 'mobile' ? 'com.auto-test.mobile-agent'
    : kind === 'pc' ? 'com.auto-test.pc-agent'
    : 'com.auto-test.agent';
  let sshConn: { conn: SshClient; end: () => void } | null = null;
  try {
    // 2026-06-27: Windows 服务名跟 deploy 脚本里 New-Service 一致 — 用 unitName
    // (含 .service 后缀,Windows 允许;deploy 端 __SERVICE_NAME__ 也是这么替换的)。
    const serviceName = effectiveOs === 'macos' ? plistLabel : unitName;
    console.log(`[agent-push] stop start kind=${kind} device=${id} name="${name}" host=${ssh_user}@${ssh_host}:${ssh_port ?? 22} os=${effectiveOs} service=${serviceName}`);
    sshConn = await connectSsh({
      host: ssh_host,
      port: ssh_port ?? 22,
      username: ssh_user,
      password: plaintextPassword ?? undefined,
      privateKey: plaintextKey ?? undefined,
    });
    if (effectiveOs === 'macos') {
      // launchctl unload 已加载的 plist,返回非零 = 没加载(已停),忽略
      const res = await execCommand(sshConn.conn, `sudo launchctl unload /Library/LaunchDaemons/${plistLabel}.plist 2>/dev/null; true`, 'stop');
      if (res.code !== 0) {
        throw new Error(`launchctl unload failed (code=${res.code}): ${res.stderr.slice(-300)}`);
      }
    } else if (effectiveOs === 'windows') {
      // Stop-Service 找不到服务会抛异常(包含 "Cannot find any service" 或中文
      // "无法查找"),匹配这些视为已停;其它异常按失败处理。
      const ps = `try { Stop-Service -Name '${unitName}' -Force -ErrorAction Stop; exit 0 } catch { if ($_.Exception.Message -match 'Cannot find any service|无法查找|没有启动') { exit 0 } else { exit 1 } }`;
      const res = await execCommand(sshConn.conn, `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, 'stop');
      if (res.code !== 0) {
        throw new Error(`Stop-Service failed (code=${res.code}): ${res.stderr.slice(-300)}`);
      }
    } else {
      const res = await execCommand(sshConn.conn, `sudo systemctl stop ${unitName}`, 'stop');
      if (res.code !== 0 && res.code !== 5) {  // 5 = unit not loaded = already stopped
        throw new Error(`systemctl stop failed (code=${res.code}): ${res.stderr.slice(-300)}`);
      }
    }
    console.log(`[agent-push] stop ok kind=${kind} device=${id} os=${effectiveOs} service=${serviceName}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent-push] stop failed kind=${kind} device=${id}: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    try { sshConn?.end(); } catch { /* ignore */ }
  }
}

/** 2026-06-08: mobile-agent stop 入口(走 stopAgent 但传 'mobile')。 */
export async function stopMobileAgent(device: DeviceRow): Promise<{ ok: boolean; error?: string }> {
  return stopAgent(device, 'mobile');
}

// 2026-06-15: pc-agent push/stop 入口(走 pushAgentByKind/stopAgent 但传 'pc')。
export async function pushPcAgent(device: DeviceRow, options: PushOptions = {}): Promise<PushResult> {
  return pushAgentByKind(device, 'pc', options);
}
export async function stopPcAgent(device: DeviceRow): Promise<{ ok: boolean; error?: string }> {
  return stopAgent(device, 'pc');
}

// ── helpers ──

/** Quote a string for safe inclusion in `echo '...'` on a remote bash. */
function shellQuote(s: string): string {
  // Wrap in single quotes; escape any embedded single quotes as '\''
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function systemdUnitContent(token: string, serverUrl: string, deviceName: string, entryPoint: string): string {
  // 2026-06-27: 用 bundle 内的 prebuilt node,不再要求远端预装 node。
  const nodeBin = nodeBinaryInstallPath('linux', '/opt/auto-test-agent');
  // 2026-06-28: mobile agent 需要 adb,从 bundle 内的 adb-runtime 加载。
  const adbPath = '/opt/auto-test-agent/adb-runtime/platform-tools';
  return `[Unit]
Description=Auto Test Agent (${deviceName})
After=network.target

[Service]
Type=simple
Environment="AGENT_TOKEN=${token}"
Environment="AGENT_SERVER_URL=${serverUrl}"
Environment="AGENT_NAME=${deviceName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)}"
Environment="AGENT_BROWSERS_PATH=/opt/auto-test-agent/browsers"
Environment="PATH=${adbPath}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=${nodeBin} /opt/auto-test-agent/${entryPoint}
WorkingDirectory=/opt/auto-test-agent
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`;
}

/**
 * 2026-06-09: macOS launchd plist 内容。
 * - ProgramArguments 用 bundle 内 prebuilt node(node-runtime/bin/node),
 *   不再依赖远端预装/homebrew node
 * - EnvironmentVariables 直接 inline,launchd 不读 /etc/<name>.env
 * - RunAtLoad + KeepAlive = 开机自启 + 进程崩了自动拉起
 * - 日志到 /var/log/auto-test-agent.log(由 deploy 脚本先 touch + chmod 666)
 */
interface PlistContentArgs {
  label: string;
  token: string;
  serverUrl: string;
  deviceName: string;
  agentPort: number;
  entryPoint: string;
  kind: 'web' | 'mobile' | 'pc';
}
function plistContent(args: PlistContentArgs): string {
  const safeName = args.deviceName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
  // 2026-06-27: macOS 也走 bundle 内 node,跟 Linux 一致
  const nodeBin = nodeBinaryInstallPath('darwin', '/opt/auto-test-agent');
  // 2026-06-28: mobile agent 需要 adb,从 bundle 内的 adb-runtime 加载。
  const adbPath = '/opt/auto-test-agent/adb-runtime/platform-tools';
  const envDict = [
    `    <key>AGENT_TOKEN</key>`,
    `    <string>${args.token}</string>`,
    `    <key>AGENT_SERVER_URL</key>`,
    `    <string>${args.serverUrl}</string>`,
    `    <key>AGENT_NAME</key>`,
    `    <string>${safeName}</string>`,
    `    <key>AGENT_PORT</key>`,
    `    <string>${args.agentPort}</string>`,
    `    <key>AGENT_BROWSERS_PATH</key>`,
    `    <string>/opt/auto-test-agent/browsers</string>`,
    `    <key>PATH</key>`,
    `    <string>${adbPath}:/usr/local/bin:/usr/bin:/bin</string>`,
  ];
  if (args.kind === 'mobile') {
    envDict.push(`    <key>AGENT_MOBILE_PORT</key>`, `    <string>${args.agentPort}</string>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${args.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>/opt/auto-test-agent/${args.entryPoint}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envDict.join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/auto-test-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/auto-test-agent.log</string>
  <key>WorkingDirectory</key>
  <string>/opt/auto-test-agent</string>
</dict>
</plist>`;
}
