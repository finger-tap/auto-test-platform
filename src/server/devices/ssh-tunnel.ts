// 2026-06-09: 通用 SSH LocalForward 隧道,让 server 端"以为"是本地端口实际是远端服务
//
// 用法: 给定一台远端机器的 SSH 凭据 + 远端要访问的 (host, port),本地起一个
// 随机端口监听,server 进程内 adb / hdc / WDA 客户端连 127.0.0.1:本地端口 就
// 等同于连 远端:port。这让 mobile-executor 不需要为"远端"另写一套,
// 现有的 `agentFromAdbDevice('xxx')` 走 local adb-server 也能落到远端 adb-server。
//
// 实现方式: 用 ssh2 的 `forwardOut(srcIP, srcPort, dstIP, dstPort)` —
// server 端开 net.createServer,每个新连接用 forwardOut 拿到一个 ClientChannel,
// 然后双向 pipe。这是 ssh2 文档里"reverse port forwarding via standard TCP forwarding"
// 的标准做法,跟 `ssh -L local:remote:dst` 等价但不需要外部 ssh 进程。
//
// 复用: 现成的 src/server/agent-push/ssh-client.ts(connectSsh + 凭据解密逻辑)。
// 一个 SSH 连接可以承载多个 forward(每条 forward 独立开一个 channel),
// 所以用同一个 conn 隧道 5037(adb) + 8100(WDA)是 OK 的。

import { createServer, type Server, type Socket } from 'node:net';
import type { Client, ClientChannel } from 'ssh2';
import { connectSsh } from '../agent-push/ssh-client.js';

export interface TunnelSpec {
  /** 远端要访问的服务地址(通常 127.0.0.1) */
  remoteHost: string;
  /** 远端服务端口 — adb=5037,hdc=5037(共用),WDA=8100 */
  remotePort: number;
  /** server 端本地监听端口,默认 0 让 OS 分配 */
  localPort?: number;
  /** server 端本地监听地址,默认 127.0.0.1(只本机访问,避免暴露) */
  localHost?: string;
}

export interface ActiveTunnel {
  localPort: number;
  remoteHost: string;
  remotePort: number;
  /** 关闭隧道,释放本地端口 + 不再接受新连接 */
  close: () => Promise<void>;
}

export interface SshCredsForTunnel {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/**
 * 跟 ssh-client.ts 里 connectSsh 的形态对齐:已经连接好的 Client 也可以直接传进来,
 * 这样多个 tunnel 共享一个长 SSH 连接。
 */
export type TunnelConnProvider =
  | { kind: 'new'; creds: SshCredsForTunnel }
  | { kind: 'existing'; conn: Client; endConn: () => void };

const TUNNEL_CONNECT_TIMEOUT_MS = 8_000;

/**
 * 建立一条本地 → 远端 的 TCP 隧道。返回的 ActiveTunnel 上有本地监听端口,
 * 调用方传这个端口给 adb / hdc / WDA 客户端。
 *
 * 失败模式: 鉴权错 / 端口被占 / ssh 连接断 / 远端服务无响应。全部 throw,
 * 上层(mobile-executor)把错翻译成对用户友好的提示。
 */
export async function openSshTunnel(
  provider: TunnelConnProvider,
  spec: TunnelSpec,
): Promise<ActiveTunnel> {
  const localHost = spec.localHost ?? '127.0.0.1';
  const remoteHost = spec.remoteHost;
  const remotePort = spec.remotePort;
  const localPort = spec.localPort ?? 0;

  let ownsConn = false;
  let endConn: () => void = () => {};
  let connRef: Client;
  if (provider.kind === 'existing') {
    // 复用外部 SSH 连接 — 不持有生命周期
    connRef = provider.conn;
  } else {
    // 全新连接 — 这里要等鉴权完成才能拿 connRef,所以用 await
    const r = await connectSsh(provider.creds);
    ownsConn = true;
    connRef = r.conn;
    endConn = () => r.end();
  }

  // 监听本地端口
  const server: Server = createServer();
  const connections = new Set<{ sock: Socket; channel: ClientChannel }>();

  const trackAndPipe = (sock: Socket, channel: ClientChannel) => {
    const entry = { sock, channel };
    connections.add(entry);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      connections.delete(entry);
      try { sock.destroy(); } catch { /* ignore */ }
      try { channel.close(); } catch { /* ignore */ }
    };
    sock.on('close', cleanup);
    sock.on('error', cleanup);
    channel.on('close', cleanup);
    channel.on('error', cleanup);
    sock.pipe(channel);
    channel.pipe(sock);
  };

  const listeningPromise = new Promise<number>((resolve, reject) => {
    const onError = (err: Error) => reject(new Error(`local listen failed: ${err.message}`));
    server.once('error', onError);
    server.listen(localPort, localHost, () => {
      server.off('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error(`local listen returned no address`));
      }
    });
  });

  const actualLocalPort = await listeningPromise;
  console.log(`[ssh-tunnel] local ${localHost}:${actualLocalPort} → remote ${remoteHost}:${remotePort}`);

  server.on('connection', (sock: Socket) => {
    // 给每次新连接用 forwardOut 拿一个 channel
    const srcIP = localHost;
    const srcPort = sock.localPort ?? 0;
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch { /* ignore */ }
    }, TUNNEL_CONNECT_TIMEOUT_MS);
    connRef.forwardOut(srcIP, srcPort, remoteHost, remotePort, (err, channel) => {
      clearTimeout(timer);
      if (err) {
        console.log(`[ssh-tunnel] forwardOut failed ${localHost}:${srcPort} → ${remoteHost}:${remotePort}: ${err.message}`);
        try { sock.destroy(); } catch { /* ignore */ }
        return;
      }
      trackAndPipe(sock, channel);
    });
  });

  const close = async (): Promise<void> => {
    // 1. 关掉所有现存的 socket + channel
    for (const c of connections) {
      try { c.sock.destroy(); } catch { /* ignore */ }
      try { c.channel.close(); } catch { /* ignore */ }
    }
    connections.clear();
    // 2. 关本地监听
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // 3. 如果这个 tunnel 自己拥有 SSH 连接,也关
    if (ownsConn) {
      endConn();
    }
    console.log(`[ssh-tunnel] closed ${localHost}:${actualLocalPort} → ${remoteHost}:${remotePort}`);
  };

  return {
    localPort: actualLocalPort,
    remoteHost,
    remotePort,
    close,
  };
}

/**
 * 给定一台 device 记录,返回 SSH 凭据(明文 password / private_key 已解密)。
 * 找不到任一必填字段 → 返回 null,调用方提示用户先在设备表里配 SSH。
 *
 * 复用 push.ts 里的同样解密逻辑 — push.ts 用了 ssh_auth_type + decryptColumn,
 * 我们保持一致。
 */
export function resolveSshCredsForDevice(device: {
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_user: string | null;
  ssh_auth_type: string | null;
  ssh_password: string | null;
  ssh_private_key: string | null;
}): SshCredsForTunnel | null {
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) return null;
  // 解密由调用方在 db 层处理(decryptColumn 是同步的),这里只读 plain text
  // — 实际 push.ts 走的是把密码/密钥从 DB 行里现解的路径。我们延用同模式:
  // 调用方先调 decryptColumn 再传过来。这是为了避免再引一遍 crypto。
  return {
    host: device.ssh_host,
    port: device.ssh_port ?? 22,
    username: device.ssh_user,
    password: device.ssh_password ?? undefined,
    privateKey: device.ssh_private_key ?? undefined,
  };
}
