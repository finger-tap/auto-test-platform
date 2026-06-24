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
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      const msg = `SSH to ${creds.username}@${creds.host}:${creds.port} failed: ${err.message}`;
      reject(new Error(msg));
      try { conn.end(); } catch { /* ignore */ }
    };

    conn.on('ready', () => {
      if (settled) return;
      settled = true;
      resolve({
        conn,
        end: () => {
          try { conn.end(); } catch { /* already closed */ }
        },
      });
    });
    conn.on('error', onError);
    // 'close' fires after end() and after auth failures; treat as a
    // duplicate error if we haven't settled yet (rare race).
    conn.on('close', () => {
      if (!settled) onError(new Error('connection closed before ready'));
    });

    conn.connect({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      privateKey: creds.privateKey,
      readyTimeout: 20_000,
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
export function sftpUpload(
  conn: Client,
  remotePath: string,
  src: Readable,
  onProgress?: (bytesWritten: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { src.unpipe(); } catch { /* ignore */ }
      reject(err);
    };

    conn.sftp((sftpErr, sftp: SFTPWrapper) => {
      if (sftpErr) { fail(sftpErr instanceof Error ? sftpErr : new Error(String(sftpErr))); return; }
      const ws = sftp.createWriteStream(remotePath);
      let written = 0;
      src.on('data', (chunk) => {
        written += (chunk as Buffer).length;
        if (onProgress) onProgress(written);
      });
      src.on('error', fail);
      ws.on('error', fail);
      ws.on('close', () => {
        if (!settled) { settled = true; resolve(); }
      });
      src.pipe(ws);
    });
  });
}

/**
 * Run a command on the SSH channel, capture stdout/stderr, return
 * when the channel closes. Streams both to the console with an
 * [agent-push:ssh] prefix for live operator feedback during deploys.
 */
export function execCommand(conn: Client, command: string, label = 'exec'): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream: ClientChannel) => {
      if (err) { reject(err instanceof Error ? err : new Error(String(err))); return; }
      let stdout = '';
      let stderr = '';
      stream.on('close', (code: number | null, signal: string | null) => {
        console.log(`[agent-push:ssh] ${label} exit code=${code} signal=${signal} stdout=${stdout.length}B stderr=${stderr.length}B`);
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
