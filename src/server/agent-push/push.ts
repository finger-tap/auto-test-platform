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
//   5. Optional: poll /healthz for up to 15s to confirm the agent came
//      back online. A failure here does NOT count as a push failure
//      (systemd restart can race), but we log it for the UI.
//
// The deploy script is inlined as a template literal and sent via `bash -s`
// (stdin → heredoc). This avoids the round-trip of writing it to a file
// on the remote and then running it.
//
// Failure semantics: any error (connect, upload, exec non-zero) returns
// `{ ok: false, error: '...' }` and the caller (routes/devices.ts) writes
// the error to `devices.last_push_error` and the UI shows it.
//
// Time budget: a typical push takes 1-2 minutes (mostly upload). We use
// a soft budget of 5 minutes — if the SSH exec call hasn't returned by
// then, the promise rejects with a timeout error. (The socket stays open
// in the background; we don't actively kill it — that would be racy with
// the remote's systemctl. The connection is closed by the next tick.)

import { createBundleStream } from './bundler.js';
import { connectSsh, sftpUpload, execCommand } from './ssh-client.js';
import { decryptColumn } from './crypto.js';
import type { DeviceRow } from '../db/devices.js';
import { recordPushResult } from '../db/devices.js';
import type { Client as SshClient } from 'ssh2';

const PUSH_TIMEOUT_MS = 5 * 60 * 1000;       // 5 min soft cap
const HEALTHZ_POLL_TIMEOUT_MS = 15_000;
const HEALTHZ_POLL_INTERVAL_MS = 1_000;

export interface PushResult {
  ok: boolean;
  version?: string;
  took_ms: number;
  error?: string;
  bytes_uploaded?: number;
  /** combined stdout/stderr from the deploy script (for debugging) */
  deploy_log_tail?: string;
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
BUNDLE_NEW="/opt/auto-test-agent-bundle-new"

echo "[deploy] moving bundle to $BUNDLE_PATH"
mv /tmp/agent-bundle-latest.tar.gz "$BUNDLE_PATH"

echo "[deploy] extracting to $BUNDLE_NEW"
rm -rf "$BUNDLE_NEW"
mkdir -p "$BUNDLE_NEW"
tar -xzf "$BUNDLE_PATH" -C "$BUNDLE_NEW"

echo "[deploy] verifying sha256"
cd "$BUNDLE_NEW"
if ! sha256sum -c bundle.sha256 >/tmp/agent-bundle.sha256.log 2>&1; then
  echo "[deploy] sha256 verification FAILED, see /tmp/agent-bundle.sha256.log"
  exit 1
fi

echo "[deploy] atomic swap"
[ -d /opt/auto-test-agent-old ] && rm -rf /opt/auto-test-agent-old
if [ -d /opt/auto-test-agent ]; then
  mv /opt/auto-test-agent /opt/auto-test-agent-old
fi
mv "$BUNDLE_NEW" /opt/auto-test-agent
rm -f "$BUNDLE_PATH"

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
echo "[deploy] WARNING: agent did not respond to /healthz within 15s"
exit 0
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

export async function pushAgent(device: DeviceRow): Promise<PushResult> {
  return pushAgentByKind(device, 'web');
}

/**
 * 2026-06-08: 远端 mobile-agent 推送 — 跟 web-agent 共用同一份 bundle
 * (mobile-agent-src/ 也打在 bundle 里),但 systemd unit 名 / port / entry 都不同。
 */
export async function pushMobileAgent(device: DeviceRow): Promise<PushResult> {
  return pushAgentByKind(device, 'mobile');
}

async function pushAgentByKind(device: DeviceRow, kind: 'web' | 'mobile' | 'pc'): Promise<PushResult> {
  const t0 = Date.now();
  const { id, name, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, agent_token, os_type } = device;
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
  const entryPoint = kind === 'mobile' ? 'mobile-agent-src/index.js'
    : kind === 'pc' ? 'pc-agent-src/index.js'
    : 'agent-src/index.js';

  // 2026-06-09: 远端 OS 决定 systemd(Linux)还是 launchd(macOS)。
  // os_type 为空 → 兜底 Linux(老数据,UI 上没填)。
  const effectiveOs: 'linux' | 'macos' = os_type === 'macos' ? 'macos' : 'linux';

  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, took_ms: 0, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux' && os_type !== 'macos') {
    return { ok: false, took_ms: 0, error: `OS "${os_type}" is not supported (only linux / macos)` };
  }
  if (!agent_token) {
    return { ok: false, took_ms: 0, error: 'Device has no agent_token' };
  }
  if (!process.env.PUBLIC_SERVER_URL) {
    return { ok: false, took_ms: 0, error: 'PUBLIC_SERVER_URL env var not set; cannot compose agent .env' };
  }

  const plaintextPassword = ssh_auth_type === 'password' ? decryptColumn('ssh_password', ssh_password) : null;
  const plaintextKey = ssh_auth_type === 'private_key' ? decryptColumn('ssh_private_key', ssh_private_key) : null;
  if (ssh_auth_type === 'password' && !plaintextPassword) {
    return { ok: false, took_ms: 0, error: 'ssh_password present but could not decrypt (key missing or ciphertext corrupt)' };
  }
  if (ssh_auth_type === 'private_key' && !plaintextKey) {
    return { ok: false, took_ms: 0, error: 'ssh_private_key present but could not decrypt' };
  }

  const bundle = createBundleStream();
  let bytesUploaded = 0;
  let sshConn: { conn: SshClient; end: () => void } | null = null;
  let lastError: string | null = null;

  const pushWithTimeout = (async () => {
    try {
      const meta = await bundle.ready;
      console.log(`[agent-push] start kind=${kind} device=${id} name="${name}" host=${ssh_user}@${ssh_host}:${ssh_port ?? 22} files=${meta.fileCount} bundleSize=${(meta.totalBytes / 1024 / 1024).toFixed(1)}MB version=${meta.version}`);

      sshConn = await connectSsh({
        host: ssh_host,
        port: ssh_port ?? 22,
        username: ssh_user,
        password: plaintextPassword ?? undefined,
        privateKey: plaintextKey ?? undefined,
      });
      console.log(`[agent-push] ssh connected to ${ssh_user}@${ssh_host}:${ssh_port ?? 22}`);

      // 1. Upload to /tmp/agent-bundle-latest.tar.gz (deploy script renames
      //    it to a timestamped name so concurrent pushes don't collide).
      const remotePath = '/tmp/agent-bundle-latest.tar.gz';
      const tUpload = Date.now();
      await sftpUpload(sshConn.conn, remotePath, bundle.stream, (b) => { bytesUploaded = b; });
      console.log(`[agent-push] upload ok bytes=${bytesUploaded} took=${Date.now() - tUpload}ms`);

      // 2. 写 agent env 文件 + 服务自启定义(systemd unit / launchd plist)。
      //    env 文件对两边一致(都读 /etc/auto-test-agent.env);service 文件按 OS 分。
      //    2026-06-09: launchd 路径额外写了 plist 的 EnvironmentVariables dict,
      //    因为 launchd 不会自动读 /etc/<name>.env — plist 里直接 inline 简单。
      const envContent = [
        `AGENT_TOKEN=${agent_token}`,
        `AGENT_SERVER_URL=${process.env.PUBLIC_SERVER_URL}`,
        `AGENT_NAME=${name.replace(/\s+/g, '-').slice(0, 32)}`,
        `AGENT_PORT=${agentPort}`,
        ...(kind === 'mobile' ? [`AGENT_MOBILE_PORT=${agentPort}`] : []),
        ...(kind === 'pc' ? [`AGENT_PC_PORT=${agentPort}`] : []),
        '',
      ].join('\n');
      const envPath = '/etc/auto-test-agent.env';
      // Use sudo only if we're not root. The deploy script needs the env
      // file to be readable by the systemd unit, which runs as root by
      // default. macOS plist 直接 inline env,不依赖这个文件,但写出来不亏
      // (老脚本要)。
      const writeEnvCmd = `echo ${shellQuote(envContent)} | sudo tee ${envPath} >/dev/null && sudo chmod 600 ${envPath}`;
      const envRes = await execCommand(sshConn.conn, writeEnvCmd, 'write-env');
      if (envRes.code !== 0) {
        throw new Error(`write env file failed: ${envRes.stderr.slice(-500)}`);
      }

      // 3. 写 service 定义 — Linux = systemd unit,macOS = launchd plist。
      if (effectiveOs === 'macos') {
        const plistPath = `/Library/LaunchDaemons/${plistLabel}.plist`;
        const plistText = plistContent({
          label: plistLabel,
          token: agent_token,
          serverUrl: process.env.PUBLIC_SERVER_URL!,
          deviceName: name,
          agentPort,
          entryPoint,
          kind,
        });
        // 幂等 — 已存在则跳过(用户可能手动改了 plist)
        const writePlistCmd = `sudo bash -c 'if [ ! -f ${plistPath} ]; then cat > ${plistPath} <<PLIST_EOF
${plistText}
PLIST_EOF
sudo chmod 644 ${plistPath}
fi'`;
        const plistRes = await execCommand(sshConn.conn, writePlistCmd, 'write-plist');
        if (plistRes.code !== 0) {
          throw new Error(`write launchd plist failed: ${plistRes.stderr.slice(-500)}`);
        }
      } else {
        const unitContent = systemdUnitContent(agent_token, process.env.PUBLIC_SERVER_URL!, name, entryPoint);
        const unitPath = `/etc/systemd/system/${unitName}`;
        const writeUnitCmd = `sudo bash -c 'if [ ! -f ${unitPath} ]; then cat > ${unitPath} <<UNIT_EOF
${unitContent}
UNIT_EOF
fi'`;
        const unitRes = await execCommand(sshConn.conn, writeUnitCmd, 'write-unit');
        if (unitRes.code !== 0) {
          throw new Error(`write systemd unit failed: ${unitRes.stderr.slice(-500)}`);
        }
      }

      // 4. Run the deploy script (extract, verify, swap, restart).
      //    DEPLOY_SCRIPT 是 OS 无关的通用模板,占位符按 OS 替换:
      //      __SERVICE_SETUP__  → systemctl 或 launchctl 命令
      //      __HEALTHZ_PORT__   → 跟 listen 端口对齐
      //      __UNIT_NAME__ / __PLIST_LABEL__  → 在 SERVICE_SETUP_* 内引用
      const healthzPort = agentPort;
      const serviceSetup = (effectiveOs === 'macos' ? SERVICE_SETUP_MACOS : SERVICE_SETUP_LINUX)
        .replace(/__UNIT_NAME__/g, unitName)
        .replace(/__PLIST_LABEL__/g, plistLabel);
      const deployScriptFor = DEPLOY_SCRIPT
        .replace(/__HEALTHZ_PORT__/g, String(healthzPort))
        .replace(/__SERVICE_SETUP__/g, serviceSetup);
      const deployRes = await execCommand(sshConn.conn, `sudo bash -s <<'DEPLOY_EOF'\n${deployScriptFor}\nDEPLOY_EOF`, 'deploy');
      const logTail = (deployRes.stdout + deployRes.stderr).slice(-2000);
      if (deployRes.code !== 0) {
        throw new Error(`deploy script failed (code=${deployRes.code}): ${logTail}`);
      }

      const took = Date.now() - t0;
      console.log(`[agent-push] push ok kind=${kind} device=${id} version=${meta.version} bytes=${bytesUploaded} took=${took}ms`);
      recordPushResult(id, 'ok');
      return {
        ok: true,
        version: meta.version,
        took_ms: took,
        bytes_uploaded: bytesUploaded,
        deploy_log_tail: logTail,
      } as PushResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      console.error(`[agent-push] push failed kind=${kind} device=${id}: ${msg}`);
      recordPushResult(id, 'error', msg);
      return { ok: false, took_ms: Date.now() - t0, error: msg } as PushResult;
    } finally {
      try { bundle.stream.destroy(); } catch { /* ignore */ }
      try { sshConn?.end(); } catch { /* ignore */ }
    }
  })();

  const timeout = new Promise<PushResult>((resolve) => {
    setTimeout(() => {
      const msg = `push timed out after ${PUSH_TIMEOUT_MS / 1000}s (last error: ${lastError ?? 'none'})`;
      console.error(`[agent-push] ${msg}`);
      recordPushResult(id, 'error', msg);
      try { bundle.stream.destroy(); } catch { /* ignore */ }
      try { sshConn?.end(); } catch { /* ignore */ }
      resolve({ ok: false, took_ms: PUSH_TIMEOUT_MS, error: msg });
    }, PUSH_TIMEOUT_MS);
  });

  return Promise.race([pushWithTimeout, timeout]);
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
  const { id, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = device;
  const effectiveOs: 'linux' | 'macos' = os_type === 'macos' ? 'macos' : 'linux';

  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux' && os_type !== 'macos') {
    return { ok: false, error: `OS "${os_type}" is not supported` };
  }

  const plaintextPassword = ssh_auth_type === 'password' ? decryptColumn('ssh_password', ssh_password) : null;
  const plaintextKey = ssh_auth_type === 'private_key' ? decryptColumn('ssh_private_key', ssh_private_key) : null;
  if (ssh_auth_type === 'password' && !plaintextPassword) {
    return { ok: false, error: 'ssh_password could not be decrypted' };
  }
  if (ssh_auth_type === 'private_key' && !plaintextKey) {
    return { ok: false, error: 'ssh_private_key could not be decrypted' };
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
    } else {
      const res = await execCommand(sshConn.conn, `sudo systemctl stop ${unitName}`, 'stop');
      if (res.code !== 0 && res.code !== 5) {  // 5 = unit not loaded = already stopped
        throw new Error(`systemctl stop failed (code=${res.code}): ${res.stderr.slice(-300)}`);
      }
    }
    console.log(`[agent-push] stop ok kind=${kind} device=${id} os=${effectiveOs}`);
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
export async function pushPcAgent(device: DeviceRow): Promise<PushResult> {
  return pushAgentByKind(device, 'pc');
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
  return `[Unit]
Description=Auto Test Agent (${deviceName})
After=network.target

[Service]
Type=simple
Environment="AGENT_TOKEN=${token}"
Environment="AGENT_SERVER_URL=${serverUrl}"
Environment="AGENT_NAME=${deviceName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)}"
ExecStart=/usr/bin/node /opt/auto-test-agent/${entryPoint}
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
 * - ProgramArguments 用 /usr/bin/env node(走 PATH 找 node;homebrew 装在
 *   /usr/local/bin 或 /opt/homebrew/bin 都行)
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
  const envDict = [
    `    <key>AGENT_TOKEN</key>`,
    `    <string>${args.token}</string>`,
    `    <key>AGENT_SERVER_URL</key>`,
    `    <string>${args.serverUrl}</string>`,
    `    <key>AGENT_NAME</key>`,
    `    <string>${safeName}</string>`,
    `    <key>AGENT_PORT</key>`,
    `    <string>${args.agentPort}</string>`,
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
    <string>/usr/bin/env</string>
    <string>node</string>
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
