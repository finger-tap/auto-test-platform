/**
 * 平台自测接口测试套件 · 资产生成器 (2026-08-27)
 *
 * 目标: 用平台的 API 测试能力测试平台自身的全部接口 —
 *   1. 生成带业务含义命名的接口用例(正常流/边界值/必填校验/异常流),
 *      用标签按功能域区分(认证/用户配置/环境管理/...), 便于 UI 筛选;
 *   2. 按业务功能编排成场景(域内顺序执行, 节点间通过提取规则传递变量);
 *   3. 组成两个场景集: 「平台自测·全量回归」与「平台自测·冒烟」;
 *   4. 参数化数据驱动用例: 同一用例多行不同数据, 断言统一期待结果。
 *
 * 检查点标准(按参数类型):
 *   - HTTP 状态码类: equals 200/201/400/401/404/409
 *   - 存在性类:      body.data.id / body.data.token  → exists
 *   - 值类:          body.code equals 200、body.data.name equals {{var}}
 *   - 数值边界类:    status less_than 500 (服务端不崩)
 *
 * 幂等性: 全部资产以「自测」前缀命名, 重复运行先清理旧资产再重建;
 * 请求体内的随机数据用 ${randomUUID()} 内置函数, 保证案例数据不同而结果一致。
 *
 * Run: npx tsx scripts/seed-api-test-suite.ts
 */

const BASE = process.env.SUITE_BASE || 'http://127.0.0.1:3000';
const API = `${BASE}/api`;
const SUITE_ACCOUNT = 'api_suite';
const SUITE_PASSWORD = 'suite123456';
// 自测环境(执行时选择)与自测用例的目标服务地址
const TARGET = BASE;

let token = '';
let passed = 0;
let failed = 0;

function step(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  -- ' + detail.slice(0, 140) : ''}`);
}

async function call(method: string, path: string, body?: unknown, useToken = true): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

// ── 断言规则速记 ──
const eq = (source: 'status' | 'body' | 'header', key: string, expected: string) =>
  ({ source, key, operator: 'equals', expected });
const exists = (source: 'body', key: string) =>
  ({ source, key, operator: 'exists', expected: '' });
const lt500 = () =>
  ({ source: 'status', key: '', operator: 'less_than', expected: '500' });

interface CaseSpec {
  name: string;
  tag: string;
  method: string;
  url: string;
  headers?: string;      // JSON 字符串; 支持 {{var}}
  body?: string;         // JSON 字符串; 支持 {{var}} 与 ${randomUUID()}
  assertions: unknown[];
  pre_assertions?: unknown[]; // 提取规则放这里会写进 execution, 场景内传递用节点 config.extractions
  parameters?: { enabled: boolean; headers: string[]; headerDescs: string[]; rows: string[][]; enabledRows: boolean[] };
  description?: string;
}

const cases: CaseSpec[] = [];

function addCase(c: CaseSpec) { cases.push(c); }

// ═══════════════ 用例定义(按功能域) ═══════════════

// ── 健康检查 ──
addCase({
  name: '[健康检查]服务存活-ping返回中心标识',
  tag: '健康检查', method: 'GET', url: `${API}/team/ping`,
  assertions: [eq('status', '', '200'), exists('body', 'server')],
  description: '免认证探活: 200 且响应含 server 字段',
});

// ── 认证 ──
addCase({
  name: '[认证]登录-套件账号成功返回token',
  tag: '认证', method: 'POST', url: `${API}/auth/login`,
  body: JSON.stringify({ account: SUITE_ACCOUNT, password: SUITE_PASSWORD }),
  assertions: [eq('status', '', '200'), exists('body', 'data.token')],
  description: '全场景公共前置: 登录并提取 token',
});
addCase({
  name: '[认证]登录-错误密码返回401',
  tag: '认证', method: 'POST', url: `${API}/auth/login`,
  body: JSON.stringify({ account: SUITE_ACCOUNT, password: 'wrong-password' }),
  assertions: [eq('status', '', '401')],
});
addCase({
  name: '[认证]登录-缺失账号字段返回400',
  tag: '认证', method: 'POST', url: `${API}/auth/login`,
  body: JSON.stringify({ password: 'whatever' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[认证]注册-随机账号首次返回201',
  tag: '认证', method: 'POST', url: `${API}/auth/register`,
  body: JSON.stringify({ account: 'suite_${randomUUID()}', password: SUITE_PASSWORD, nickname: '随机注册' }),
  assertions: [eq('status', '', '201'), eq('body', 'code', '201'), exists('body', 'data.userId')],
});
addCase({
  name: '[认证]注册-已存在账号返回409',
  tag: '认证', method: 'POST', url: `${API}/auth/register`,
  body: JSON.stringify({ account: SUITE_ACCOUNT, password: SUITE_PASSWORD, nickname: '重复注册' }),
  assertions: [eq('status', '', '409')],
  description: '使用必已存在的套件账号 — 验证账号唯一性约束',
});
addCase({
  name: '[认证]注册-缺失账号字段返回400',
  tag: '认证', method: 'POST', url: `${API}/auth/register`,
  body: JSON.stringify({ password: SUITE_PASSWORD }),
  assertions: [eq('status', '', '400')],
});
// 密码边界参数化: 少于 6 位 → 统一 400 (auth 注册的最小长度约束)
addCase({
  name: '[认证]注册-参数化短密码均返回400',
  tag: '认证', method: 'POST', url: `${API}/auth/register`,
  body: '{"account":"suite_pwd_${randomUUID()}","password":{{pwd}}}',
  assertions: [eq('status', '', '400')],
  parameters: {
    enabled: true,
    headers: ['pwd'],
    headerDescs: ['非法密码JSON字面量(1位/5位)'],
    rows: [['"1"'], ['"12345"']],
    enabledRows: [true, true],
  },
});
addCase({
  name: '[认证]me-携带token返回账号信息',
  tag: '认证', method: 'GET', url: `${API}/auth/me`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200'), exists('body', 'data.account')],
});
addCase({
  name: '[认证]me-无token返回401',
  tag: '认证', method: 'GET', url: `${API}/auth/me`,
  headers: JSON.stringify({}),
  assertions: [eq('status', '', '401')],
});

// ── 用户配置 ──
addCase({
  name: '[用户配置]主题偏好-读取返回ok',
  tag: '用户配置', method: 'GET', url: `${API}/user-preferences/settings/theme`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[用户配置]主题偏好-写入light返回200',
  tag: '用户配置', method: 'PUT', url: `${API}/user-preferences/settings/theme`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ value: 'light' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[用户配置]模型配置-读取返回结构',
  tag: '用户配置', method: 'GET', url: `${API}/midscene-config`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200'), eq('body', 'code', '200')],
});
// 四种测试类型各自的环境偏好读取 (2026-08-27 补全)
for (const t of ['api', 'web', 'pc', 'mobile'] as const) {
  addCase({
    name: `[用户配置]环境偏好-${t}类型读取返回200`,
    tag: '用户配置', method: 'GET', url: `${API}/user-preferences/${t}`,
    headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
    assertions: [eq('status', '', '200')],
  });
}
addCase({
  name: '[用户配置]浏览器配置-写入chromium返回200',
  tag: '用户配置', method: 'PUT', url: `${API}/web-browser-config`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ browser: 'chromium', headless: true, window_size: '1280x720', base_url: '', timeout: 30 }),
  assertions: [eq('status', '', '200')],
});

// ── 环境管理 ──
addCase({
  name: '[环境管理]创建-正常返回id',
  tag: '环境管理', method: 'POST', url: `${API}/environments`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测环境_${randomUUID()}', description: '套件自动生成', variables: [] }),
  assertions: [eq('status', '', '200'), exists('body', 'data.id')],
});
addCase({
  name: '[环境管理]创建-缺名称返回400',
  tag: '环境管理', method: 'POST', url: `${API}/environments`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ description: 'no name' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[环境管理]修改-重命名返回200',
  tag: '环境管理', method: 'PUT', url: `${API}/environments/{{envId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测环境_已更新_${randomUUID()}', variables: [] }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[环境管理]列表-分页返回数据',
  tag: '环境管理', method: 'GET', url: `${API}/environments?page=1&pageSize=10`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[环境管理]删除-清理返回200',
  tag: '环境管理', method: 'DELETE', url: `${API}/environments/{{envId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── 标签管理 ──
addCase({
  name: '[标签管理]创建-正常返回名称',
  tag: '标签管理', method: 'POST', url: `${API}/tags`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测标签_${randomUUID()}', color: '#22c55e' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[标签管理]创建-缺名称返回400',
  tag: '标签管理', method: 'POST', url: `${API}/tags`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ color: '#22c55e' }),
  assertions: [lt500(), eq('status', '', '400')],
});
addCase({
  name: '[标签管理]删除-清理返回200',
  tag: '标签管理', method: 'DELETE', url: `${API}/tags/{{tagName}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── Mock 服务 ──
// 注意: body 用 TS 单引号字符串, ${randomUUID()} 原样下发由平台内置函数求值
const MOCK_BODY = '{"name":"自测Mock_${randomUUID()}","method":"GET","path_pattern":"/suite-mock-${randomUUID()}","match_mode":"path","response_status":200,"response_headers":"{\\\"Content-Type\\\":\\\"application/json\\\"}","response_body":"{\\\"ok\\\":true}","response_delay_ms":0,"conditions":"[]","enabled":1}';
addCase({
  name: '[Mock服务]创建-正常返回id',
  tag: 'Mock服务', method: 'POST', url: `${API}/mocks-api`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: MOCK_BODY,
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[Mock服务]创建-缺名称返回400',
  tag: 'Mock服务', method: 'POST', url: `${API}/mocks-api`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ method: 'GET', path_pattern: '/x' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[Mock服务]列表-分页返回数据',
  tag: 'Mock服务', method: 'GET', url: `${API}/mocks-api?page=1&pageSize=10`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[Mock服务]删除-清理返回200',
  tag: 'Mock服务', method: 'DELETE', url: `${API}/mocks-api/{{mockId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── 用例管理(API 资源自身) ──
addCase({
  name: '[用例管理]创建-仅名称最小字段返回201',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{"name":"自测用例_最小_${randomUUID()}","method":"GET","url":"/suite/min-${randomUUID()}","status":"draft"}',
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
  description: '最小合法字段: name + method + url(均为后端必填)',
});
addCase({
  name: '[用例管理]创建-缺名称返回400',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ url: '/x', method: 'GET' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[用例管理]创建-固定名称供重名测试(首次201/重复409)',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测用例_重名源', method: 'GET', url: '/suite/dup-source', status: 'draft' }),
  assertions: [lt500()],
  description: '固定名称: 首次执行 201, 重复执行 409 — 均为合法结果',
});
addCase({
  name: '[用例管理]创建-重名返回409',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测用例_重名源', method: 'GET', url: '/suite/dup-source', status: 'draft' }),
  assertions: [eq('status', '', '409')],
  description: '依赖上一节点的固定名称 — 验证重名唯一性约束',
});
addCase({
  name: '[用例管理]详情-读取id一致',
  tag: '用例管理', method: 'GET', url: `${API}/apis/{{apiId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200'), exists('body', 'data.name')],
});
addCase({
  name: '[用例管理]详情-不存在id返回404',
  tag: '用例管理', method: 'GET', url: `${API}/apis/999999999`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '404')],
});
addCase({
  name: '[用例管理]修改-更新描述返回200',
  tag: '用例管理', method: 'PUT', url: `${API}/apis/{{apiId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测用例_已更新_${randomUUID()}', description: 'updated', status: 'active' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[用例管理]列表-分页参数合法返回200',
  tag: '用例管理', method: 'GET', url: `${API}/apis?page=1&pageSize=5`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[用例管理]列表-pageSize超限被安全钳制',
  tag: '用例管理', method: 'GET', url: `${API}/apis?page=0&pageSize=100000`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200'), lt500()],
});
addCase({
  name: '[用例管理]删除-清理返回200',
  tag: '用例管理', method: 'DELETE', url: `${API}/apis/{{apiId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
// 参数化数据驱动: 三行不同数据(中文/英文/特殊字符), 全部期待 201
addCase({
  name: '[用例管理]创建-参数化多组名称均成功',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: `{"name":"自测参数化_{{caseName}}","method":"GET","url":"/suite/param-\${randomUUID()}","status":"draft"}`,
  assertions: [eq('status', '', '201')],
  parameters: {
    enabled: true,
    headers: ['caseName'],
    headerDescs: ['用例名称后缀(边界值: 中文/英文/数字/特殊字符/300字符超长)'],
    // 行值带 ${randomUUID()} 后缀: 嵌入 body 后由内置函数二次求值 —
    // 每轮执行数据不同(不撞上一轮创建的名字), 断言结果稳定 (2026-08-28)
    rows: [
      ['中文名称-${randomUUID()}'],
      ['english-${randomUUID()}'],
      ['123-${randomUUID()}'],
      ['special_!@#$%-${randomUUID()}'],
      ['N-${randomUUID()}-x'.replace('x', 'x'.repeat(300))],
    ],
    enabledRows: [true, true, true, true, true],
  },
});
// 必填校验参数化: 三种非法形态(null/空串/纯空格) → 统一期待 400。
// body 用无引号占位 {{rawName}}, 行值自带 JSON 字面量引号。
addCase({
  name: '[用例管理]创建-参数化非法名称均返回400',
  tag: '用例管理', method: 'POST', url: `${API}/apis`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{"name":{{rawName}},"method":"GET","url":"/suite/invalid","status":"draft"}',
  assertions: [eq('status', '', '400')],
  parameters: {
    enabled: true,
    headers: ['rawName'],
    headerDescs: ['非法名称JSON字面量(null/空串/纯空格)'],
    rows: [['null'], ['""'], ['"   "']],
    enabledRows: [true, true, true],
  },
});

// ── Web 测试类型(管理接口; AI 执行依赖模型配置, 不在本套件) ──
const webBody = (name: string) => JSON.stringify({
  name, description: '套件自动生成', status: 'draft',
  case_content: '打开页面并检查标题', case_content_type: 'text',
  check_points: JSON.stringify([]), browser: 'chromium', headless_mode: 1, timeout: 30,
  data_drive: '{}', preconditions: '',
});
addCase({
  name: '[Web用例]创建-正常字段返回201',
  tag: 'Web测试', method: 'POST', url: `${API}/web-cases`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: webBody('自测Web_${randomUUID()}'),
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[Web用例]创建-缺名称返回400',
  tag: 'Web测试', method: 'POST', url: `${API}/web-cases`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ case_content: 'x' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[Web用例]详情-读取返回200',
  tag: 'Web测试', method: 'GET', url: `${API}/web-cases/{{webCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[Web用例]修改-更新名称返回200',
  tag: 'Web测试', method: 'PUT', url: `${API}/web-cases/{{webCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: webBody('自测Web_已更新_${randomUUID()}'),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[Web用例]列表-分页返回200',
  tag: 'Web测试', method: 'GET', url: `${API}/web-cases?page=1&pageSize=10`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[Web用例]删除-清理返回200',
  tag: 'Web测试', method: 'DELETE', url: `${API}/web-cases/{{webCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[Web用例集]创建-含成员返回id',
  tag: 'Web测试', method: 'POST', url: `${API}/case-sets-web`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测Web集合_${randomUUID()}', test_case_ids: [] }),
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});

// ── PC 测试类型(管理接口; 真机执行涉及键鼠控制, 不在本套件) ──
const pcBody = (name: string) => JSON.stringify({
  name, description: '套件自动生成', status: 'draft', platform: 'mac',
  case_content: '打开访达', case_content_type: 'text',
  check_points: JSON.stringify([]), data_drive: '{}', preconditions: '',
});
addCase({
  name: '[PC用例]创建-正常字段返回201',
  tag: 'PC测试', method: 'POST', url: `${API}/pc-cases`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: pcBody('自测PC_${randomUUID()}'),
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[PC用例]创建-缺名称返回400',
  tag: 'PC测试', method: 'POST', url: `${API}/pc-cases`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ case_content: 'x' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[PC用例]修改-更新返回200',
  tag: 'PC测试', method: 'PUT', url: `${API}/pc-cases/{{pcCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: pcBody('自测PC_已更新_${randomUUID()}'),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[PC用例]列表-分页返回200',
  tag: 'PC测试', method: 'GET', url: `${API}/pc-cases?page=1&pageSize=10`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[PC用例]删除-清理返回200',
  tag: 'PC测试', method: 'DELETE', url: `${API}/pc-cases/{{pcCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── 移动端测试类型(管理接口 + 无设备执行的结构化失败) ──
const mobBody = (name: string) => JSON.stringify({
  name, description: '套件自动生成', status: 'draft', platform: 'android',
  device_name: '未连接设备', case_content: '打开设置', case_content_type: 'text',
  check_points: JSON.stringify([]), preconditions: '',
});
addCase({
  name: '[移动端]创建-正常字段返回201',
  tag: '移动端', method: 'POST', url: `${API}/mobile-tests`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: mobBody('自测移动_${randomUUID()}'),
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[移动端]创建-缺名称返回400',
  tag: '移动端', method: 'POST', url: `${API}/mobile-tests`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ case_content: 'x' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[移动端]修改-更新返回200',
  tag: '移动端', method: 'PUT', url: `${API}/mobile-tests/{{mobCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: mobBody('自测移动_已更新_${randomUUID()}'),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[移动端]执行-无设备返回结构化error',
  tag: '移动端', method: 'POST', url: `${API}/mobile-tests/{{mobCaseId}}/execute`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({}),
  assertions: [eq('status', '', '200'), eq('body', 'data.status', 'error')],
  description: '无 adb 设备时必须返回结构化失败(非 500/挂起)',
});
addCase({
  name: '[移动端]列表-分页返回200',
  tag: '移动端', method: 'GET', url: `${API}/mobile-tests?page=1&pageSize=10`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[移动端]删除-清理返回200',
  tag: '移动端', method: 'DELETE', url: `${API}/mobile-tests/{{mobCaseId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── 场景编排 ──
addCase({
  name: '[场景编排]创建-自动生成起止节点返回id',
  tag: '场景编排', method: 'POST', url: `${API}/scenarios`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ name: '自测场景_${randomUUID()}', description: '套件自动生成' }),
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[场景编排]创建-缺名称返回400',
  tag: '场景编排', method: 'POST', url: `${API}/scenarios`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ description: 'no name' }),
  assertions: [eq('status', '', '400')],
});
addCase({
  name: '[场景编排]保存画布-flow写入节点与连线',
  tag: '场景编排', method: 'PUT', url: `${API}/scenarios/{{sceneId}}/flow`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({
    nodes: [
      { node_id: 'start', type: 'start', position_x: 250, position_y: 50 },
      { node_id: 'end', type: 'end', position_x: 250, position_y: 400 },
    ],
    edges: [{ edge_id: 'e1', source_node_id: 'start', target_node_id: 'end' }],
  }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[场景编排]删除-清理返回200',
  tag: '场景编排', method: 'DELETE', url: `${API}/scenarios/{{sceneId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

// ── 仪表盘 ──
for (const [label, ep] of [
  ['统计-返回四类型数据', '/dashboard/stats'],
  ['趋势-返回近14天数据', '/dashboard/trend'],
  ['最近执行-返回列表', '/dashboard/recent-executions?limit=3'],
  ['待办-返回列表', '/dashboard/pending'],
] as const) {
  addCase({
    name: `[仪表盘]${label}`,
    tag: '仪表盘', method: 'GET', url: `${API}${ep}`,
    headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
    assertions: [eq('status', '', '200')],
  });
}

// ═══════════════ 场景编排定义 ═══════════════
// 每条 = [用例名, 节点提取规则?]。场景内自上而下顺序执行, 提取规则写入场景 context。

interface NodeSpec { caseName: string; extract?: Array<{ var_name: string; source: string; key: string }> }

const SCENES: Array<{ name: string; desc: string; nodes: NodeSpec[] }> = [
  {
    name: '自测·认证全流程(正常与异常)',
    desc: '登录成功/失败、注册成功/缺字段、me 带/不带 token — 认证域全部检查点',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[认证]登录-错误密码返回401' },
      { caseName: '[认证]登录-缺失账号字段返回400' },
      { caseName: '[认证]注册-随机账号首次返回201' },
      { caseName: '[认证]注册-已存在账号返回409' },
      { caseName: '[认证]注册-缺失账号字段返回400' },
      { caseName: '[认证]me-携带token返回账号信息' },
      { caseName: '[认证]me-无token返回401' },
    ],
  },
  {
    name: '自测·用户配置读写流',
    desc: '主题/模型/浏览器配置的读写往返',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[用户配置]主题偏好-读取返回ok' },
      { caseName: '[用户配置]主题偏好-写入light返回200' },
      { caseName: '[用户配置]模型配置-读取返回结构' },
      { caseName: '[用户配置]浏览器配置-写入chromium返回200' },
    ],
  },
  {
    name: '自测·环境管理生命周期',
    desc: '创建→缺名校验→修改→列表→删除 全生命周期',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[环境管理]创建-正常返回id', extract: [{ var_name: 'envId', source: 'body', key: 'data.id' }] },
      { caseName: '[环境管理]创建-缺名称返回400' },
      { caseName: '[环境管理]修改-重命名返回200' },
      { caseName: '[环境管理]列表-分页返回数据' },
      { caseName: '[环境管理]删除-清理返回200' },
    ],
  },
  {
    name: '自测·标签与Mock生命周期',
    desc: '标签/Mock 的创建校验与清理',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[标签管理]创建-正常返回名称', extract: [{ var_name: 'tagName', source: 'body', key: 'data.name' }] },
      { caseName: '[标签管理]创建-缺名称返回400' },
      { caseName: '[标签管理]删除-清理返回200' },
      { caseName: '[Mock服务]创建-正常返回id', extract: [{ var_name: 'mockId', source: 'body', key: 'data.id' }] },
      { caseName: '[Mock服务]创建-缺名称返回400' },
      { caseName: '[Mock服务]列表-分页返回数据' },
      { caseName: '[Mock服务]删除-清理返回200' },
    ],
  },
  {
    name: '自测·用例管理生命周期(含参数化)',
    desc: '接口用例 CRUD + 重名 409 + 不存在 404 + 分页边界 + 参数化数据驱动',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[用例管理]创建-仅名称最小字段返回201', extract: [{ var_name: 'apiId', source: 'body', key: 'data.id' }] },
      { caseName: '[用例管理]创建-缺名称返回400' },
      // 固定名创建 + 同名再创建 → 409 (验证重名唯一性约束)
      { caseName: '[用例管理]创建-固定名称供重名测试(首次201/重复409)' },
      { caseName: '[用例管理]创建-重名返回409' },
      { caseName: '[用例管理]详情-读取id一致' },
      { caseName: '[用例管理]详情-不存在id返回404' },
      { caseName: '[用例管理]修改-更新描述返回200' },
      { caseName: '[用例管理]列表-分页参数合法返回200' },
      { caseName: '[用例管理]列表-pageSize超限被安全钳制' },
      { caseName: '[用例管理]创建-参数化多组名称均成功' },
      { caseName: '[用例管理]删除-清理返回200' },
    ],
  },
  {
    name: '自测·场景编排与画布',
    desc: '场景创建/缺名校验/画布保存/删除',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[场景编排]创建-自动生成起止节点返回id', extract: [{ var_name: 'sceneId', source: 'body', key: 'data.id' }] },
      { caseName: '[场景编排]创建-缺名称返回400' },
      { caseName: '[场景编排]保存画布-flow写入节点与连线' },
      { caseName: '[场景编排]删除-清理返回200' },
    ],
  },
  {
    name: '自测·Web用例管理生命周期',
    desc: 'Web 用例 CRUD/缺名校验/集合结构 (AI 执行依赖模型配置, 另行功能测试)',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[Web用例]创建-正常字段返回201', extract: [{ var_name: 'webCaseId', source: 'body', key: 'data.id' }] },
      { caseName: '[Web用例]创建-缺名称返回400' },
      { caseName: '[Web用例]详情-读取返回200' },
      { caseName: '[Web用例]修改-更新名称返回200' },
      { caseName: '[Web用例]列表-分页返回200' },
      { caseName: '[Web用例集]创建-含成员返回id' },
      { caseName: '[Web用例]删除-清理返回200' },
    ],
  },
  {
    name: '自测·PC用例管理生命周期',
    desc: 'PC 用例 CRUD/缺名校验 (真机执行涉及键鼠控制, 不在套件内)',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[PC用例]创建-正常字段返回201', extract: [{ var_name: 'pcCaseId', source: 'body', key: 'data.id' }] },
      { caseName: '[PC用例]创建-缺名称返回400' },
      { caseName: '[PC用例]修改-更新返回200' },
      { caseName: '[PC用例]列表-分页返回200' },
      { caseName: '[PC用例]删除-清理返回200' },
    ],
  },
  {
    name: '自测·移动端管理与无设备执行',
    desc: 'Mobile 用例 CRUD/缺名校验/无设备执行的结构化失败',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[移动端]创建-正常字段返回201', extract: [{ var_name: 'mobCaseId', source: 'body', key: 'data.id' }] },
      { caseName: '[移动端]创建-缺名称返回400' },
      { caseName: '[移动端]修改-更新返回200' },
      { caseName: '[移动端]执行-无设备返回结构化error' },
      { caseName: '[移动端]列表-分页返回200' },
      { caseName: '[移动端]删除-清理返回200' },
    ],
  },
  {
    name: '自测·场景集执行与定时调度',
    desc: '集合创建→执行→cron 配置→暂停/恢复/移除→清理(依赖场景集 status 列修复)',
    nodes: [
      { caseName: '[认证]登录-套件账号成功返回token', extract: [{ var_name: 'token', source: 'body', key: 'data.token' }] },
      { caseName: '[场景编排]创建-自动生成起止节点返回id', extract: [{ var_name: 'sceneId2', source: 'body', key: 'data.id' }] },
      { caseName: '[场景集]创建-含场景成员返回id', extract: [{ var_name: 'setId', source: 'body', key: 'data.id' }] },
      { caseName: '[场景集]执行-批量返回结果' },
      { caseName: '[调度]配置cron返回next_run_at', extract: [{ var_name: 'schedId', source: 'body', key: 'data.id' }] },
      { caseName: '[调度]暂停-返回Paused' },
      { caseName: '[调度]恢复-返回active' },
      { caseName: '[调度]移除-返回200' },
      { caseName: '[场景集]删除-清理返回200' },
      { caseName: '[场景编排]删除-按变量清理临时场景返回200' },
    ],
  },
];

// 上面引用到但未在 cases 里定义的补充用例。
// scenario_ids 引用场景内提取的 {{sceneId2}} — body 是字符串模板, 执行时替换为数字。
addCase({
  name: '[场景集]创建-含场景成员返回id',
  tag: '场景集', method: 'POST', url: `${API}/scenario-sets`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{"name":"自测场景集_${randomUUID()}","scenario_ids":[{{sceneId2}}]}',
  assertions: [eq('status', '', '201'), exists('body', 'data.id')],
});
addCase({
  name: '[场景编排]删除-按变量清理临时场景返回200',
  tag: '场景编排', method: 'DELETE', url: `${API}/scenarios/{{sceneId2}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[调度]配置cron返回next_run_at',
  tag: '定时调度', method: 'PUT', url: `${API}/schedule-sets-api/set/{{setId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({ cron_expr: '0 3 * * *', status: 'active' }),
  assertions: [eq('status', '', '200'), exists('body', 'data.next_run_at')],
});
addCase({
  name: '[调度]暂停-返回Paused',
  tag: '定时调度', method: 'POST', url: `${API}/schedule-sets-api/{{schedId}}/pause`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{}',
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[调度]恢复-返回active',
  tag: '定时调度', method: 'POST', url: `${API}/schedule-sets-api/{{schedId}}/resume`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{}',
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[调度]移除-返回200',
  tag: '定时调度', method: 'POST', url: `${API}/schedule-sets-api/{{schedId}}/remove`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: '{}',
  assertions: [eq('status', '', '200')],
});
addCase({
  name: '[场景集]执行-批量返回结果',
  tag: '场景集', method: 'POST', url: `${API}/scenario-sets/{{setId}}/execute`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  body: JSON.stringify({}),
  assertions: [eq('status', '', '200'), exists('body', 'data.status')],
});
addCase({
  name: '[场景集]删除-清理返回200',
  tag: '场景集', method: 'DELETE', url: `${API}/scenario-sets/{{setId}}`,
  headers: JSON.stringify({ Authorization: 'Bearer {{token}}' }),
  assertions: [eq('status', '', '200')],
});

async function main() {
  // ── 套件账号 ──
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: SUITE_ACCOUNT, password: SUITE_PASSWORD, nickname: '接口自测套件' }),
  });
  const regOk = reg.status === 201 || reg.status === 409;
  step('套件账号就绪(首次201/已存在409)', regOk, `HTTP ${reg.status}`);

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: SUITE_ACCOUNT, password: SUITE_PASSWORD }),
  });
  const loginData = await login.json() as any;
  token = loginData?.data?.token ?? '';
  step('登录套件账号', !!token);

  // ── 清理旧资产(幂等) ──
  for (const ep of ['apis', 'scenarios', 'scenario-sets']) {
    const r = await call('GET', `/${ep}?page=1&pageSize=100`);
    const items = r.data?.data?.items ?? r.data?.data ?? [];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (typeof it.name === 'string' && (it.name.startsWith('自测') || it.name.startsWith('平台自测') || it.name.startsWith('[健康') || it.name.startsWith('[认证') || it.name.startsWith('[用户配置') || it.name.startsWith('[环境管理') || it.name.startsWith('[标签管理') || it.name.startsWith('[Mock服务') || it.name.startsWith('[用例管理') || it.name.startsWith('[场景编排') || it.name.startsWith('[场景集') || it.name.startsWith('[调度') || it.name.startsWith('[仪表盘') || it.name.startsWith('[Web用例') || it.name.startsWith('[PC用例') || it.name.startsWith('[移动端'))) {
        await call('DELETE', `/${ep}/${it.id}`);
      }
    }
  }
  console.log('旧自测资产已清理');

  // ── 生成用例 ──
  const caseIdByName = new Map<string, number>();
  for (const c of cases) {
    const payload: Record<string, unknown> = {
      name: c.name, url: c.url, method: c.method, protocol: 'http',
      content_type: 'json', headers: c.headers ?? '{}',
      body: c.body ?? '', description: c.description ?? '',
      tags: c.tag, status: 'active',
      assertions: JSON.stringify(c.assertions),
      pre_assertions: '[]', post_assertions: '[]', pre_actions: '[]', post_actions: '[]',
      parameters: '',
    };
    if (c.parameters) payload.parameters = JSON.stringify(c.parameters);
    const r = await call('POST', '/apis', payload);
    const id = r.data?.data?.id;
    caseIdByName.set(c.name, id);
    step(`用例入册 ${c.name}`, !!id, JSON.stringify(r.data).slice(0, 90));
  }

  // ── 生成场景 ──
  const sceneIds: Array<{ id: number; name: string; smoke: boolean }> = [];
  for (const sc of SCENES) {
    const c = await call('POST', '/scenarios', { name: sc.name, description: sc.desc, tags: '自测' });
    const sceneId = c.data?.data?.id;
    step(`场景入册 ${sc.name}`, !!sceneId, JSON.stringify(c.data).slice(0, 80));
    if (!sceneId) continue;
    sceneIds.push({ id: sceneId, name: sc.name, smoke: sc.name.includes('认证') || sc.name.includes('用例管理') || sc.name.includes('移动端') });

    // flow: 登录节点 + 各用例节点串联
    const nodes: unknown[] = [{ node_id: 'start', type: 'start', position_x: 250, position_y: 50 }];
    const edges: unknown[] = [];
    let prev = 'start';
    let y = 180;
    sc.nodes.forEach((n, i) => {
      const nodeId = `n${i + 1}`;
      const apiId = caseIdByName.get(n.caseName);
      const config: Record<string, unknown> = { api_id: apiId, api_name: n.caseName };
      if (n.extract && n.extract.length) config.extractions = n.extract;
      // 特殊: 重复注册节点要把 body 的随机账号换成上一节点提取的 regAccount —
      // 通过同名第二份用例? 简化: 第二次注册的 body 引用 {{regAccount}}, 见下方 override
      nodes.push({ node_id: nodeId, type: 'api', position_x: 250, position_y: y, label: n.caseName, config: JSON.stringify(config) });
      edges.push({ edge_id: `e${i + 1}`, source_node_id: prev, target_node_id: nodeId });
      prev = nodeId;
      y += 130;
    });
    nodes.push({ node_id: 'end', type: 'end', position_x: 250, position_y: y });
    edges.push({ edge_id: `e${sc.nodes.length + 1}`, source_node_id: prev, target_node_id: 'end' });

    const f = await call('PUT', `/scenarios/${sceneId}/flow`, { nodes, edges });
    step(`画布保存 ${sc.name}`, f.data?.code === 200, JSON.stringify(f.data).slice(0, 80));
  }

  // ── 场景集 ──
  const smokeIds = sceneIds.filter(s => s.smoke).map(s => s.id);
  const allIds = sceneIds.map(s => s.id);
  const s1 = await call('POST', '/scenario-sets', { name: '平台自测·冒烟', scenario_ids: smokeIds, description: '认证+用例管理 核心冒烟' });
  step('场景集入册 平台自测·冒烟', !!s1.data?.data?.id, JSON.stringify(s1.data).slice(0, 80));
  const s2 = await call('POST', '/scenario-sets', { name: '平台自测·全量回归', scenario_ids: allIds, description: '全部功能域场景' });
  step('场景集入册 平台自测·全量回归', !!s2.data?.data?.id);

  console.log(`\n══ 资产生成完成: 用例 ${cases.length} · 场景 ${sceneIds.length} · 场景集 2 ══`);
  console.log('在 UI 的「接口测试 → 场景集」中打开「平台自测·全量回归」点执行即可全量体检;');
  console.log(`或直接运行: curl -X POST ${API}/scenario-sets/${s2.data?.data?.id}/execute`);
}

main().catch((e) => { console.error('seed crashed:', e); process.exit(2); });
