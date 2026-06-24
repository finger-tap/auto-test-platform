/**
 * HTTPS 测试服务器
 * 用法: npx tsx test/https/https-test-server.ts
 *
 * 端点:
 *   GET /hello    — 简单返回，验证基础 HTTPS 连通
 *   POST /echo    — 回显请求头和 Body
 *   GET /secure   — 要求客户端证书（双向 TLS），返回客户端 CN
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certsDir = path.join(__dirname, 'certs');

const PORT = 3443;

// 加载证书
// requestCert: true — 请求客户端证书（但不拒绝无证书的连接）
// rejectUnauthorized: false — 无证书时不断开连接，由端点自行判断
const serverOptions: https.ServerOptions = {
  cert: fs.readFileSync(path.join(certsDir, 'server.crt')),
  key: fs.readFileSync(path.join(certsDir, 'server.key')),
  ca: fs.readFileSync(path.join(certsDir, 'ca.crt')),
  requestCert: true,
  rejectUnauthorized: false,
};

// 简易路由
const server = https.createServer(serverOptions, (req, res) => {
  const url = new URL(req.url || '/', `https://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  // 公开端点 — 不要求客户端证书
  if (route === 'GET /hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello from HTTPS', timestamp: new Date().toISOString() }));
    return;
  }

  if (route === 'POST /echo') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        timestamp: new Date().toISOString(),
      }));
    });
    return;
  }

  // 安全端点 — 要求客户端证书（mTLS）
  if (route === 'GET /secure') {
    const socket = req.socket as import('node:tls').TLSSocket;
    const cert = socket.getPeerCertificate();
    // 没有客户端证书时 getPeerCertificate 返回空对象
    if (!cert || !cert.subject || Object.keys(cert.subject).length === 0) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '客户端证书 required' }));
      return;
    }
    const authorized = socket.authorized;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'authenticated via mTLS',
      clientCN: cert.subject.CN || 'unknown',
      clientIssuer: cert.issuer?.CN || 'unknown',
      authorized,
      validFrom: cert.valid_from,
      validTo: cert.valid_to,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[https-test-server] listening on https://localhost:${PORT}`);
  console.log(`[https-test-server] 端点:`);
  console.log(`  GET  /hello   — 基础 HTTPS 连通测试`);
  console.log(`  POST /echo    — 回显请求`);
  console.log(`  GET  /secure  — 双向 TLS（需客户端证书）`);
  console.log();
  console.log(`按 Ctrl+C 停止`);
});
