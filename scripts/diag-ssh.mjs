#!/usr/bin/env node
// 2026-06-27: SSH 连接诊断脚本。
// 用法: node scripts/diag-ssh.mjs <host> <port> <user> <password>
// 用途: 命令行 ssh 能连但 server 端 ssh2 连不上时,本脚本输出握手全过程的
//       ssh2 debug 日志(KEX 协商 / cipher 选择 / banner 交换 / 认证),
//       用于定位 Windows OpenSSH 兼容性 / 算法不匹配 / 网络拦截等问题。
//
// 典型场景: Windows OpenSSH server,命令行能连,ssh2 报
//   "Timed out while waiting for handshake"
// 本脚本会输出远端发回的 banner、协商的 KEX/Cipher/MAC、认证方式、错误堆栈。

import { connectSsh, execCommand } from '../src/server/agent-push/ssh-client.ts';

const [host, portStr, user, password] = process.argv.slice(2);
if (!host || !portStr || !user || !password) {
  console.error('Usage: node scripts/diag-ssh.mjs <host> <port> <user> <password>');
  process.exit(2);
}
const port = parseInt(portStr, 10);

console.log(`[diag-ssh] testing ${user}@${host}:${port} password=***`);
console.log('[diag-ssh] note: ssh2 debug events are already wired in ssh-client.ts');
console.log('[diag-ssh] connecting...');

try {
  const t0 = Date.now();
  const { conn, end } = await connectSsh({ host, port, username: user, password });
  console.log(`[diag-ssh] connected in ${Date.now() - t0}ms`);
  const r = await execCommand(conn, 'echo SSH-EXEC-OK && uname -a 2>/dev/null || ver', 'diag');
  console.log('[diag-ssh] exec result:');
  console.log('  code =', r.code);
  console.log('  stdout =', r.stdout.trim());
  if (r.stderr) console.log('  stderr =', r.stderr.trim());
  end();
  console.log('[diag-ssh] SUCCESS');
  process.exit(0);
} catch (e) {
  console.error('[diag-ssh] FAILED:', e instanceof Error ? e.message : String(e));
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
}
