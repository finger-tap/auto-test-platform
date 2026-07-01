// 2026-06-07: thin wrapper around the ssh2 Client.
//
// Two operations matter for the push flow:
//   1. upload(bundleStream, remotePath) — SFTP createWriteStream + pipe
//   2. exec(command) — run a shell command, capture stdout/stderr/exit
//
// We use the Promise wrappers because ssh2 is callback-based. Timeout
// is enforced on connect (`readyTimeout`) — exec/upload themselves run
// at network speed; the caller is responsible for bounding them
// (e.g. push.ts uses a soft wall of N minutes and aborts on overrun).
//
// All errors are normalized to `Error` with a stable message; the push
// orchestrator (push.ts) treats every error as "log + return to UI".

import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { Readable } from 'node:stream';

export interface SshCredentials {
  host: string;
  port: number;
  username: string;
  /** plaintext — caller is expected to decrypt from the device row */
  password?: string;
  privateKey?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
}

/**
 * Establish an SSH connection. Resolves with a connected Client (and an
 * `end()` function to close it cleanly). Rejects on auth/host failure
 * with an Error that names the host so the UI can show a useful message.
 */
export function connectSsh(creds: SshCredentials): Promise<{ conn: Client; end: () => void }> {
  const t0 = Date.now();
  console.log(`[agent-push:ssh] connectSsh initiating ${creds.username}@${creds.host}:${creds.port} auth=${creds.password ? 'password' : creds.privateKey ? 'privateKey' : 'none'}`);
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      const msg = `SSH to ${creds.username}@${creds.host}:${creds.port} failed: ${err.message}`;
      console.error(`[agent-push:ssh] connectSsh ERROR after ${Date.now() - t0}ms: ${msg}`);
      reject(new Error(msg));
      try { conn.end(); } catch { /* ignore */ }
    };

    conn.on('ready', () => {
      if (settled) return;
      settled = true;
      console.log(`[agent-push:ssh] connectSsh ready in ${Date.now() - t0}ms ${creds.username}@${creds.host}:${creds.port}`);
      resolve({
        conn,
        end: () => {
          try { conn.end(); } catch { /* already closed */ }
        },
      });
    });
    conn.on('error', onError);
    // 2026-06-27: 开 ssh2 'debug' 事件监听 — 输出 KEX/cipher/banner 协商细节,
    // 用于排查命令行 ssh 能连但 ssh2 不能连的场景(典型: Windows OpenSSH
    // 算法配置 / banner 交换超时)。ssh2 类型定义没声明 'debug' 事件,用 cast 绕过。
    (conn as unknown as NodeJS.EventEmitter).on('debug', (msg: string) => {
      console.error(`[agent-push:ssh] debug ${creds.host}:${creds.port} ${msg}`);
    });
    // 'close' fires after end() and after auth failures; treat as a
    // duplicate error if we haven't settled yet (rare race).
    conn.on('close', () => {
      if (!settled) onError(new Error('connection closed before ready'));
    });

    console.log(`[agent-push:ssh] connectSsh calling conn.connect() readyTimeout=20000`);
    conn.connect({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      privateKey: creds.privateKey,
      readyTimeout: 20_000,
      // Skip host key verification — managed devices may not be in known_hosts.
      hostVerifier: (_hash: string) => true,
      // Keep the keepalive at default — we close after each push anyway.
    });
  });
}

/**
 * SFTP upload: stream `src` (a Readable) to `remotePath` on the SSH
 * server. Resolves when the remote write stream closes successfully.
 * Rejects on any error (network, auth, SFTP, src). Streams are NOT
 * closed on the caller's behalf — push.ts does that.
 */
/** 30 min timeout for SFTP upload (1GB+ bundles on slow LANs need headroom). */
const SFTP_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

export function sftpUpload(
  conn: Client,
  remotePath: string,
  src: Readable,
  onProgress?: (bytesWritten: number) => void
): Promise<void> {
  const t0 = Date.now();
  console.log(`[agent-push:ssh] sftpUpload start remote=${remotePath}`);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let written = 0;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        const msg = `SFTP upload timed out after ${SFTP_UPLOAD_TIMEOUT_MS / 1000}s (wrote ${written} bytes)`;
        console.error(`[agent-push:ssh] sftpUpload TIMEOUT: ${msg}`);
        try { src.unpipe(); } catch { /* ignore */ }
        reject(new Error(msg));
      }
    }, SFTP_UPLOAD_TIMEOUT_MS);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error(`[agent-push:ssh] sftpUpload ERROR after ${Date.now() - t0}ms: ${err.message}`);
      try { src.unpipe(); } catch { /* ignore */ }
      reject(err);
    };

    console.log(`[agent-push:ssh] sftpUpload acquiring SFTP session ...`);
    conn.sftp((sftpErr, sftp: SFTPWrapper) => {
      if (sftpErr) { fail(sftpErr instanceof Error ? sftpErr : new Error(String(sftpErr))); return; }
      console.log(`[agent-push:ssh] sftpUpload SFTP session acquired in ${Date.now() - t0}ms, creating write stream to ${remotePath}`);
      // 2026-07-01: agent bundle is large because it intentionally ships
      // node-runtime + full node_modules. Use a larger write buffer than the
      // stream default to reduce backpressure churn and improve throughput on
      // LAN / high-latency SSH links without changing package contents.
      const ws = sftp.createWriteStream(remotePath, { highWaterMark: 1024 * 1024 });
      src.on('data', (chunk) => {
        written += (chunk as Buffer).length;
        if (onProgress) onProgress(written);
      });
      src.on('error', fail);
      ws.on('error', fail);
      ws.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          console.log(`[agent-push:ssh] sftpUpload complete remote=${remotePath} bytes=${written} took=${Date.now() - t0}ms`);
          resolve();
        }
      });
      console.log(`[agent-push:ssh] sftpUpload piping stream to remote ...`);
      src.pipe(ws);
    });
  });
}

/** 5 min timeout for individual SSH commands (deploy, write-env, etc.). */
const EXEC_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run a command on the SSH channel, capture stdout/stderr, return
 * when the channel closes. Streams both to the console with an
 * [agent-push:ssh] prefix for live operator feedback during deploys.
 *
 * 2026-06-27: 可选 stdin — Windows deploy 走 `powershell -Command -` 时
 * 需要把脚本通过 stdin 喂进去(Linux/Mac 仍用 bash heredoc 嵌入 command
 * 字符串,但 stdin 是更通用的方式)。
 */
export function execCommand(
  conn: Client,
  command: string,
  label = 'exec',
  stdin?: string,
): Promise<ExecResult> {
  const t0 = Date.now();
  console.log(`[agent-push:ssh] execCommand start label=${label} cmd=${command.slice(0, 120)}${command.length > 120 ? '...' : ''}${stdin ? ` stdin=${stdin.length}B` : ''}`);
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        const msg = `SSH command "${label}" timed out after ${EXEC_COMMAND_TIMEOUT_MS / 1000}s`;
        console.error(`[agent-push:ssh] execCommand TIMEOUT: ${msg}`);
        reject(new Error(msg));
      }
    }, EXEC_COMMAND_TIMEOUT_MS);

    conn.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        clearTimeout(timeout);
        console.error(`[agent-push:ssh] execCommand exec() ERROR label=${label}: ${err.message}`);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('close', (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.log(`[agent-push:ssh] ${label} exit code=${code} signal=${signal} stdout=${stdout.length}B stderr=${stderr.length}B took=${Date.now() - t0}ms`);
        resolve({ stdout, stderr, code, signal });
      });
      stream.on('data', (data: Buffer) => {
        const s = data.toString('utf8');
        stdout += s;
        // Tee to server console for live debugging
        process.stdout.write(`[agent-push:ssh] ${label} | ${s}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        const s = data.toString('utf8');
        stderr += s;
        process.stderr.write(`[agent-push:ssh] ${label} ! ${s}`);
      });
      // 2026-06-27: 可选 stdin — write + close(stdin EOF 让远端 `cmd -` 完成读取)
      if (stdin !== undefined) {
        stream.write(stdin, 'utf8');
        stream.end();
      }
    });
  });
}

/**
 * 2026-06-08: SSH LocalForward — 在 server 端开一个 127.0.0.1:<localPort> 端口,
 * 把所有流量通过已建立的 SSH 通道转发到 remote 端的 127.0.0.1:<remotePort>。
 * 用于让 server 端 adb client 把远端 mobile-agent 所在机器的 adb-server 当本地 adb 用。
 *
 * 实现方式:在 server 端起一个 net.Server,每个新 TCP 连接走一次
 * conn.forwardOut(127.0.0.1, localPort, 127.0.0.1, remotePort) 拿一个 SSH Channel,
 * socket ↔ channel 双向 pipe。这是 "TCP proxy over SSH" 的标准模式 — 每次
 * 转发都是新 channel,长期 keepalive 不会因长时间没流量被 sshd 杀。
 *
 * 注意:
 *   - 需要先 connectSsh 拿到一个可用的 conn(同一份长连接可以承载多个 forward)
 *   - `localPort` 必须本机空闲;传 0 让 OS 分配
 *   - end() 关闭本机 listener;SSH 通道由调用方决定是否也 end() 整 conn
 */
import net from 'node:net';

export interface LocalForward {
  localHost: string;
  localPort: number;
  end: () => void;
}

export function openLocalForward(
  conn: Client,
  remotePort: number,
  localPort: number = 0,
): Promise<LocalForward> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // 对每个新 TCP 客户端开一个新 SSH Channel
      conn.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort, (err, channel) => {
        if (err) {
          console.log(`[agent-push:ssh] forwardOut failed: ${err.message}`);
          socket.destroy();
          return;
        }
        // 双向桥接
        socket.pipe(channel as unknown as NodeJS.WritableStream);
        (channel as unknown as NodeJS.ReadableStream).pipe(socket);
        socket.on('error', () => { try { channel.end(); } catch { /* */ } });
        channel.on('error', () => { try { socket.destroy(); } catch { /* */ } });
        socket.on('close', () => { try { channel.end(); } catch { /* */ } });
        channel.on('close', () => { try { socket.destroy(); } catch { /* */ } });
      });
    });
    server.on('error', (e) => reject(e));
    server.listen(localPort, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to bind local forward'));
        return;
      }
      const port = addr.port;
      console.log(`[agent-push:ssh] local forward listening on 127.0.0.1:${port} → remote 127.0.0.1:${remotePort}`);
      resolve({
        localHost: '127.0.0.1',
        localPort: port,
        end: () => { server.close(); },
      });
    });
  });
}
