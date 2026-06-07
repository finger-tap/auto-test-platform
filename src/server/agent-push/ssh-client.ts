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
