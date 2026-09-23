/**
 * 演示数据生成器 (2026-08-28) — 给各页面提供"有数据"的查看效果。
 *
 * 与 seed-api-test-suite.ts (自测套件) 不同: 本脚本创建的资产**不参与执行、
 * 不会被清理流程删除**, 用于 UI 走查/演示: 场景列表、场景集、定时任务、
 * web/pc/mobile 用例列表等页面的有数据状态。
 *
 * 幂等: 「演示·」前缀资产先清后建。
 * Run: npx tsx scripts/seed-demo-data.ts
 */
const API = 'http://localhost:3000/api';
const ACCOUNT = 'api_suite';
const PASSWORD = 'suite123456';

let token = '';
let passed = 0, failed = 0;
const step = (n: string, ok: boolean, d = '') => { ok ? passed++ : failed++; console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  -- ' + d.slice(0, 100) : ''}`); };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { return { status: res.status, data: await res.json() }; } catch { return { status: res.status, data: null }; }
}

async function main() {
  const login = await call('POST', '/auth/login', { account: ACCOUNT, password: PASSWORD });
  token = login.data?.data?.token ?? '';
  if (!token) { console.error('✗ 套件账号登录失败 — 先运行 seed-api-test-suite.ts'); process.exit(2); }

  // ── 清理旧演示资产 ──
  for (const ep of ['apis', 'scenarios', 'scenario-sets', 'web-cases', 'pc-cases', 'mobile-tests', 'environments', 'mocks-api']) {
    const r = await call('GET', `/${ep}?page=1&pageSize=100`);
    const items = r.data?.data?.items ?? r.data?.data ?? [];
    if (Array.isArray(items)) {
      for (const it of items) {
        if (typeof it.name === 'string' && it.name.startsWith('演示·')) await call('DELETE', `/${ep}/${it.id}`);
      }
    }
  }
  // 旧定时配置: schedule-sets 无删除列表级联 — 由场景集删除级联(演示场景集删除时)
  console.log('旧演示资产已清理');

  // ── 环境 ──
  const env1 = await call('POST', '/environments', { name: '演示·开发环境', description: '本地开发', variables: [{ key: 'base', value: 'http://127.0.0.1:3000' }], is_default: true });
  step('环境: 开发环境', !!env1.data?.data?.id);
  const env2 = await call('POST', '/environments', { name: '演示·测试环境', description: '集成测试', variables: [{ key: 'base', value: 'http://test.example.com' }] });
  step('环境: 测试环境', !!env2.data?.data?.id);

  // ── Mock ──
  for (const [n, p] of [['用户信息', '/demo/user'], ['订单列表', '/demo/orders']]) {
    const r = await call('POST', '/mocks-api', {
      name: `演示·Mock ${n}`, method: 'GET', path_pattern: p, match_mode: 'path',
      response_status: 200, response_headers: '{"Content-Type":"application/json"}',
      response_body: JSON.stringify({ code: 0, data: { demo: n } }), response_delay_ms: 0, conditions: '[]', enabled: 1,
    });
    step(`Mock: ${n}`, r.status === 201);
  }

  // ── 标签 ──
  for (const t of ['冒烟', '回归', '核心链路']) {
    await call('POST', '/tags', { name: `演示·${t}`, color: '#6366f1' });
  }
  step('标签 ×3', true);

  // ── web/pc/mobile 用例各 2 ──
  const web1 = await call('POST', '/web-cases', {
    name: '演示·登录页冒烟', description: '打开登录页并验证元素', status: 'active', tags: '演示·冒烟',
    case_content: '打开登录页\n输入用户名 demo\n输入密码 123456\n点击登录按钮', case_content_type: 'text',
    check_points: JSON.stringify([{ type: 'text', text: '页面显示登录成功' }]),
    browser: 'chromium', headless_mode: 1, timeout: 30, data_drive: '{}', preconditions: '',
  });
  step('Web 用例: 登录页冒烟', !!web1.data?.data?.id);
  await call('POST', '/web-cases', {
    name: '演示·首页浏览', description: '', status: 'draft', tags: '演示·回归',
    case_content: '打开首页\n等待 2 秒', case_content_type: 'text',
    check_points: JSON.stringify([]), browser: 'chromium', headless_mode: 0, timeout: 30,
    data_drive: '{}', preconditions: '',
  });
  step('Web 用例: 首页浏览', true);

  for (const [n, c] of [['打开计算器', '点击计算器图标'], ['打开文本编辑', '点击文本编辑图标']]) {
    const r = await call('POST', '/pc-cases', {
      name: `演示·PC ${n}`, description: '', status: 'active', platform: 'mac',
      case_content: c, case_content_type: 'text', check_points: JSON.stringify([]),
      data_drive: '{}', preconditions: '',
    });
    step(`PC 用例: ${n}`, !!r.data?.data?.id);
  }

  const mob1 = await call('POST', '/mobile-tests', {
    name: '演示·App 启动检查', description: '', status: 'active', platform: 'android',
    device_name: '演示设备', case_content: '启动应用\n检查首页加载', case_content_type: 'text',
    check_points: JSON.stringify([]), preconditions: '',
  });
  step('Mobile 用例: App 启动检查', !!mob1.data?.data?.id);
  await call('POST', '/mobile-tests', {
    name: '演示·设置页浏览', description: '', status: 'draft', platform: 'android',
    device_name: '演示设备', case_content: '打开设置', case_content_type: 'text',
    check_points: JSON.stringify([]), preconditions: '',
  });
  step('Mobile 用例: 设置页浏览', true);

  // ── 场景(引用自建的演示 API 用例 — 生命周期与演示数据一致, 不悬空) ──
  const demoApi = await call('POST', '/apis', {
    name: '演示·健康检查接口', method: 'GET',
    url: 'http://127.0.0.1:3000/api/team/ping', protocol: 'http',
    content_type: 'json', headers: '{}', body: '',
    assertions: JSON.stringify([{ source: 'status', key: '', operator: 'equals', expected: '200' }]),
    pre_assertions: '[]', post_assertions: '[]', pre_actions: '[]', post_actions: '[]',
    status: 'active', tags: '演示·核心链路',
  });
  const demoApiId = demoApi.data?.data?.id;
  step('演示 API 用例: 健康检查', !!demoApiId);

  const sceneIds: number[] = [];
  for (const n of ['演示·核心接口链路', '演示·登录后业务流']) {
    const c = await call('POST', '/scenarios', { name: n, description: '演示场景', tags: '演示·核心链路' });
    const sid = c.data?.data?.id;
    sceneIds.push(sid);
    step(`场景: ${n}`, !!sid);
    if (sid && demoApiId) {
      await call('PUT', `/scenarios/${sid}/flow`, {
        nodes: [
          { node_id: 'start', type: 'start', position_x: 250, position_y: 50 },
          { node_id: 'n1', type: 'api', position_x: 250, position_y: 190, label: '演示·健康检查接口', config: JSON.stringify({ api_id: Number(demoApiId), api_name: '演示·健康检查接口' }) },
          { node_id: 'end', type: 'end', position_x: 250, position_y: 340 },
        ],
        edges: [
          { edge_id: 'e1', source_node_id: 'start', target_node_id: 'n1' },
          { edge_id: 'e2', source_node_id: 'n1', target_node_id: 'end' },
        ],
      });
    }
  }

  // ── 场景集 ──
  const set1 = await call('POST', '/scenario-sets', { name: '演示·每日回归集', scenario_ids: sceneIds, description: '演示用集合', tags: '演示·回归' });
  step('场景集: 每日回归集', !!set1.data?.data?.id);
  await call('POST', '/scenario-sets', { name: '演示·冒烟集', scenario_ids: sceneIds.slice(0, 1), description: '', tags: '演示·冒烟' });
  step('场景集: 冒烟集', true);

  // ── 定时任务(一个 active 一个 paused, 持久保留) ──
  const sched1 = await call('PUT', `/schedule-sets-api/set/${set1.data?.data?.id}`, { cron_expr: '0 9 * * *', status: 'active' });
  step('定时: 每日回归 每天 9:00 (active)', !!sched1.data?.data?.id);
  const set2 = await call('GET', '/scenario-sets?page=1&pageSize=10&name=演示·冒烟集');
  const set2Id = (set2.data?.data?.items ?? [])[0]?.id;
  if (set2Id) {
    const sched2 = await call('PUT', `/schedule-sets-api/set/${set2Id}`, { cron_expr: '30 10 * * 1-5', status: 'paused' });
    step('定时: 冒烟集 工作日 10:30 (paused)', !!sched2.data?.data?.id);
  }

  console.log(`\n══ 演示数据完成: ${passed} 项成功, ${failed} 项失败 ══`);
  console.log('各列表页刷新即可看到「演示·」前缀数据; 重复运行本脚本会先清后建。');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('crashed:', e); process.exit(2); });
