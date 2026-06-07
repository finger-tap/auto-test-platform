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

echo "[deploy] setting up systemd"
systemctl daemon-reload
systemctl enable auto-test-agent.service 2>/dev/null || true
systemctl restart auto-test-agent.service

echo "[deploy] waiting for agent healthz"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  if curl -sf http://127.0.0.1:4001/healthz >/dev/null 2>&1; then
    echo "[deploy] agent healthy after \${i}s"
    exit 0
  fi
done
echo "[deploy] WARNING: agent did not respond to /healthz within 15s"
exit 0
`;

export async function pushAgent(device: DeviceRow): Promise<PushResult> {
  const t0 = Date.now();
  const { id, name, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, agent_token, os_type } = device;

  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, took_ms: 0, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux') {
    return { ok: false, took_ms: 0, error: `OS "${os_type}" is not supported (only linux)` };
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
      console.log(`[agent-push] start device=${id} name="${name}" host=${ssh_user}@${ssh_host}:${ssh_port ?? 22} files=${meta.fileCount} bundleSize=${(meta.totalBytes / 1024 / 1024).toFixed(1)}MB version=${meta.version}`);

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

      // 2. Write the agent env file (idempotent — only if missing).
      //    The token + server URL must already be set BEFORE the agent
      //    process starts, otherwise it'll exit on the first heartbeat.
      const envContent = [
        `AGENT_TOKEN=${agent_token}`,
        `AGENT_SERVER_URL=${process.env.PUBLIC_SERVER_URL}`,
        `AGENT_NAME=${name.replace(/\s+/g, '-').slice(0, 32)}`,
        '',
      ].join('\n');
      const envPath = '/etc/auto-test-agent.env';
      // Use sudo only if we're not root. The deploy script needs the env
      // file to be readable by the systemd unit, which runs as root by
      // default.
      const writeEnvCmd = `echo ${shellQuote(envContent)} | sudo tee ${envPath} >/dev/null && sudo chmod 600 ${envPath}`;
      const envRes = await execCommand(sshConn.conn, writeEnvCmd, 'write-env');
      if (envRes.code !== 0) {
        throw new Error(`write env file failed: ${envRes.stderr.slice(-500)}`);
      }

      // 3. Write the systemd unit (idempotent — only if missing, so we
      //    don't clobber the user's local edits to the unit).
      const unitContent = systemdUnitContent(agent_token, process.env.PUBLIC_SERVER_URL!, name);
      const unitPath = '/etc/systemd/system/auto-test-agent.service';
      const writeUnitCmd = `sudo bash -c 'if [ ! -f ${unitPath} ]; then cat > ${unitPath} <<UNIT_EOF
${unitContent}
UNIT_EOF
fi'`;
      const unitRes = await execCommand(sshConn.conn, writeUnitCmd, 'write-unit');
      if (unitRes.code !== 0) {
        throw new Error(`write systemd unit failed: ${unitRes.stderr.slice(-500)}`);
      }

      // 4. Run the deploy script (extract, verify, swap, restart).
      const deployRes = await execCommand(sshConn.conn, `sudo bash -s <<'DEPLOY_EOF'\n${DEPLOY_SCRIPT}\nDEPLOY_EOF`, 'deploy');
      const logTail = (deployRes.stdout + deployRes.stderr).slice(-2000);
      if (deployRes.code !== 0) {
        throw new Error(`deploy script failed (code=${deployRes.code}): ${logTail}`);
      }

      const took = Date.now() - t0;
      console.log(`[agent-push] push ok device=${id} version=${meta.version} bytes=${bytesUploaded} took=${took}ms`);
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
      console.error(`[agent-push] push failed device=${id}: ${msg}`);
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
 */
export async function stopAgent(device: DeviceRow): Promise<{ ok: boolean; error?: string }> {
  const { id, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, os_type } = device;
  if (!ssh_host || !ssh_user || !ssh_auth_type) {
    return { ok: false, error: 'SSH host / user / auth type not configured' };
  }
  if (os_type && os_type !== 'linux') {
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

  let sshConn: { conn: SshClient; end: () => void } | null = null;
  try {
    sshConn = await connectSsh({
      host: ssh_host,
      port: ssh_port ?? 22,
      username: ssh_user,
      password: plaintextPassword ?? undefined,
      privateKey: plaintextKey ?? undefined,
    });
    const res = await execCommand(sshConn.conn, 'sudo systemctl stop auto-test-agent.service', 'stop');
    if (res.code !== 0 && res.code !== 5) {  // 5 = unit not loaded = already stopped
      throw new Error(`systemctl stop failed (code=${res.code}): ${res.stderr.slice(-300)}`);
    }
    console.log(`[agent-push] stop ok device=${id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent-push] stop failed device=${id}: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    try { sshConn?.end(); } catch { /* ignore */ }
  }
}

// ── helpers ──

/** Quote a string for safe inclusion in `echo '...'` on a remote bash. */
function shellQuote(s: string): string {
  // Wrap in single quotes; escape any embedded single quotes as '\''
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function systemdUnitContent(token: string, serverUrl: string, deviceName: string): string {
  return `[Unit]
Description=Auto Test Agent (${deviceName})
After=network.target

[Service]
Type=simple
Environment="AGENT_TOKEN=${token}"
Environment="AGENT_SERVER_URL=${serverUrl}"
Environment="AGENT_NAME=${deviceName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)}"
ExecStart=/usr/bin/node /opt/auto-test-agent/agent-src/index.js
WorkingDirectory=/opt/auto-test-agent
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`;
}
