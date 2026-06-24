/**
 * HTTPS 接口测试
 * 验证平台通过 CA 证书、客户端证书访问 HTTPS 服务的能力
 *
 * 运行: npx tsx test/https/https-api.test.ts
 * 前置: 先启动 HTTPS 测试服务 (npx tsx test/https/https-test-server.ts)
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certsDir = path.join(__dirname, 'certs');

const BASE_URL = 'https://localhost:3443';

// ── 工具函数 ──

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

function request(url: string, options: https.RequestOptions = {}): Promise<{ status: number; body: string; error?: string }> {
  return new Promise((resolve) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', (err) => {
      resolve({ status: 0, body: '', error: err.message });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, body: '', error: 'timeout' });
    });
    req.end();
  });
}

function loadCert(name: string): string {
  return fs.readFileSync(path.join(certsDir, name), 'utf-8');
}

function certExists(name: string): boolean {
  return fs.existsSync(path.join(certsDir, name));
}

// ── 测试用例 ──

async function test1_basic_https_with_ca(): Promise<TestResult> {
  const name = '1. 单向 HTTPS + CA 证书';
  if (!certExists('ca.crt')) {
    return { name, passed: false, detail: '证书未生成，先运行 generate-certs.sh' };
  }

  const res = await request(`${BASE_URL}/hello`, {
    ca: loadCert('ca.crt'),
  });

  if (res.error) return { name, passed: false, detail: `请求失败: ${res.error}` };
  if (res.status !== 200) return { name, passed: false, detail: `状态码 ${res.status}` };

  const data = JSON.parse(res.body);
  if (data.message !== 'hello from HTTPS') {
    return { name, passed: false, detail: `响应内容不匹配: ${res.body}` };
  }
  return { name, passed: true, detail: `status=${res.status}, body=${res.body}` };
}

async function test2_https_without_ca(): Promise<TestResult> {
  const name = '2. 无 CA 访问自签服务（应失败）';

  const res = await request(`${BASE_URL}/hello`);

  // 自签证书在没有 CA 的情况下应该报错
  if (res.error && res.error.includes('self-signed')) {
    return { name, passed: true, detail: `正确拒绝: ${res.error}` };
  }
  // 某些 Node 版本报不同的错误
  if (res.error && (res.error.includes('certificate') || res.error.includes('CERT') || res.error.includes('SSL'))) {
    return { name, passed: true, detail: `正确拒绝: ${res.error}` };
  }
  if (res.status === 200) {
    return { name, passed: false, detail: `应该失败但成功了: ${res.body}` };
  }
  return { name, passed: true, detail: `请求失败: ${res.error || `status=${res.status}`}` };
}

async function test3_mtls_with_client_cert(): Promise<TestResult> {
  const name = '3. 双向 TLS（客户端证书认证）';
  if (!certExists('ca.crt') || !certExists('client.crt') || !certExists('client.key')) {
    return { name, passed: false, detail: '证书未生成，先运行 generate-certs.sh' };
  }

  const res = await request(`${BASE_URL}/secure`, {
    ca: loadCert('ca.crt'),
    cert: loadCert('client.crt'),
    key: loadCert('client.key'),
    // 必须开启 requestCert 才能发送客户端证书
    rejectUnauthorized: true,
  });

  if (res.error) return { name, passed: false, detail: `请求失败: ${res.error}` };
  if (res.status !== 200) return { name, passed: false, detail: `状态码 ${res.status}, body=${res.body}` };

  const data = JSON.parse(res.body);
  if (data.clientCN !== 'test-client') {
    return { name, passed: false, detail: `客户端 CN 不匹配: ${data.clientCN}` };
  }
  return { name, passed: true, detail: `CN=${data.clientCN}, authorized=${data.authorized}` };
}

async function test4_mtls_without_client_cert(): Promise<TestResult> {
  const name = '4. 双向 TLS 端点不带客户端证书（应返回 401）';
  if (!certExists('ca.crt')) {
    return { name, passed: false, detail: '证书未生成，先运行 generate-certs.sh' };
  }

  const res = await request(`${BASE_URL}/secure`, {
    ca: loadCert('ca.crt'),
    // 不提供客户端证书
  });

  if (res.error) return { name, passed: false, detail: `请求失败: ${res.error}` };
  if (res.status === 401) {
    return { name, passed: true, detail: `正确返回 401` };
  }
  return { name, passed: false, detail: `预期 401，实际 status=${res.status}` };
}

async function test5_invalid_cert(): Promise<TestResult> {
  const name = '5. 无效 CA 证书（应失败）';

  const res = await request(`${BASE_URL}/hello`, {
    ca: '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
  });

  if (res.error) {
    return { name, passed: true, detail: `正确拒绝: ${res.error}` };
  }
  if (res.status !== 200) {
    return { name, passed: true, detail: `请求失败: status=${res.status}` };
  }
  return { name, passed: false, detail: `应该失败但成功了` };
}

// ── 主流程 ──

async function main() {
  console.log('=== HTTPS 接口测试 ===\n');

  // 检查证书
  if (!certExists('ca.crt')) {
    console.log('证书不存在，先生成...');
    const { execSync } = await import('node:child_process');
    execSync(`bash ${path.join(__dirname, 'generate-certs.sh')}`, { stdio: 'inherit' });
    console.log();
  }

  // 检查服务是否运行
  const ping = await request(`${BASE_URL}/hello`).catch(() => null);
  if (!ping || (ping.error && ping.error.includes('ECONNREFUSED'))) {
    console.log('HTTPS 测试服务未启动，请先运行:');
    console.log('  npx tsx test/https/https-test-server.ts\n');
    process.exit(1);
  }

  const tests = [
    test1_basic_https_with_ca,
    test2_https_without_ca,
    test3_mtls_with_client_cert,
    test4_mtls_without_client_cert,
    test5_invalid_cert,
  ];

  const results: TestResult[] = [];
  for (const test of tests) {
    const result = await test();
    results.push(result);
    const icon = result.passed ? '✓' : '✗';
    console.log(`${icon} ${result.name}`);
    console.log(`  ${result.detail}\n`);
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n=== 结果: ${passed}/${total} 通过 ===`);

  if (passed < total) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
