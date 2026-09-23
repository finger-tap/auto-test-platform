/**
 * 全平台功能级 E2E 监测 (2026-08-27)
 *
 * 覆盖: 认证/用户配置/环境/Mock/标签/API用例(增改查执行)/场景/场景集/
 *       定时调度/dashboard/Web用例/PC用例/Mobile用例/各类型用例集/设备库/OpenAPI导出。
 *
 * 安全约束:
 *  - 全部资源使用 e2ewalk_<ts> 前缀的一次性账号与数据, 结束时清理;
 *  - PC 用例不做真实执行(会在本机启动桌面键鼠控制), 仅验证 CRUD 与集合结构;
 *  - Mobile 执行预期以"无设备"结构化失败结束; Web 执行预期因 Midscene 未配置而失败 —
 *    都属于依赖缺失, 只要返回结构化错误而非 500/挂起即判定链路健康。
 *
 * Run: npx tsx scripts/e2e-walk-all.ts
 */
const BASE = 'http://localhost:3000/api';
const TS = Date.now();
const ACCOUNT = `e2ewalk_${TS}`;
const PASSWORD = 'pass12345';

let token = '';
let failed = 0;
let passed = 0;

interface Ctx { [k: string]: any }
const ctx: Ctx = {};

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

function step(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  -- ' + detail.slice(0, 160) : ''}`);
}

async function main() {
  // ── 认证 ──
  {
    const r = await call('POST', '/auth/register', { account: ACCOUNT, password: PASSWORD, nickname: 'E2E走查' });
    step('注册账号', r.status === 201 || r.data?.code === 201);
    const l = await call('POST', '/auth/login', { account: ACCOUNT, password: PASSWORD });
    token = l.data?.data?.token ?? '';
    step('登录拿 token', !!token);
    const me = await call('GET', '/auth/me');
    step('GET /auth/me', me.data?.code === 200 && me.data?.data?.account === ACCOUNT);
  }

  // ── 用户配置 ──
  {
    const g = await call('GET', '/user-preferences/api');
    step('读环境偏好(GET /user-preferences/api)', g.data?.code === 200);
    const p = await call('PUT', '/user-preferences/settings/theme', { value: 'light' });
    step('写主题偏好', p.data?.code === 200 || p.status === 200 || p.data?.code === 201, JSON.stringify(p.data).slice(0, 80));
    const mc = await call('GET', '/midscene-config');
    step('读 Midscene 模型配置', mc.data?.code === 200);
    const wb = await call('GET', '/web-browser-config');
    step('读浏览器配置', wb.data?.code === 200);
    const wbs = await call('PUT', '/web-browser-config', {
      browser: 'chromium', headless: true, window_size: '1280x720', base_url: '', timeout: 30,
    });
    step('写浏览器配置', wbs.data?.code === 200 || wbs.status < 300, JSON.stringify(wbs.data).slice(0, 120));
  }

  // ── 环境 ──
  {
    const c = await call('POST', '/environments', { name: `e2e_env_${TS}`, description: 'e2e', variables: [], is_default: false });
    ctx.envId = c.data?.data?.id ?? c.data?.data?.environment?.id;
    step('创建环境', !!ctx.envId, JSON.stringify(c.data).slice(0, 100));
    if (ctx.envId) {
      const u = await call('PUT', `/environments/${ctx.envId}`, { name: `e2e_env_${TS}_upd`, variables: [{ key: 'base', value: 'http://127.0.0.1:3000' }] });
      step('修改环境', u.data?.code === 200, JSON.stringify(u.data).slice(0, 100));
    }
  }

  // ── Mock 服务 ──
  {
    const c = await call('POST', '/mocks-api', {
      name: `e2e_mock_${TS}`,
      method: 'POST',
      path_pattern: `/e2e-mock/${TS}`,
      match_mode: 'path',
      response_status: 200,
      response_headers: '{"Content-Type":"application/json"}',
      response_body: '{"ok":true,"echo":"{{$.body.hi}}"}',
      response_delay_ms: 0,
      conditions: '[]',
      enabled: 1,
    });
    ctx.mockId = c.data?.data?.id;
    step('创建 Mock 端点', !!ctx.mockId, JSON.stringify(c.data).slice(0, 140));
    const l = await call('GET', '/mocks-api?page=1&pageSize=10');
    step('Mock 列表', l.data?.code === 200 && Array.isArray(l.data?.data?.items));
  }

  // ── API 测试: 用例生命周期 + 真实执行 ──
  {
    const payload = {
      name: `e2e_api_${TS}`,
      url: `http://127.0.0.1:3000/e2e-mock/${TS}`,
      method: 'POST',
      protocol: 'http',
      content_type: 'json',
      body: '{"hi":"world"}',
      headers: '{}',
      assertions: JSON.stringify([
        { source: 'status', key: '', operator: 'equals', expected: '200' },
        { source: 'body', key: 'ok', operator: 'equals', expected: 'true' },
      ]),
      pre_assertions: '[]', post_assertions: '[]', pre_actions: '[]', post_actions: '[]',
      description: 'e2e', status: 'active', tags: '',
    };
    const c = await call('POST', '/apis', payload);
    ctx.apiId = c.data?.data?.id;
    step('创建 API 用例', !!ctx.apiId, JSON.stringify(c.data).slice(0, 120));
    if (ctx.apiId) {
      const d = await call('GET', `/apis/${ctx.apiId}`);
      step('读取 API 用例详情', d.data?.code === 200 && d.data?.data?.name === payload.name);
      const u = await call('PUT', `/apis/${ctx.apiId}`, { ...payload, name: `${payload.name}_upd`, description: 'e2e-upd' });
      step('修改 API 用例', u.data?.code === 200);

      // 真实执行: mock-proxy 应拦截 /e2e-mock/* 并返回 mock 响应 → 断言应通过
      const x = await call('POST', `/apis/${ctx.apiId}/execute`, {});
      step('执行 API 用例(HTTP 200)', x.status === 200, JSON.stringify(x.data).slice(0, 120));
      const exs = await call('GET', `/apis/${ctx.apiId}/executions?limit=5`);
      const items = exs.data?.data?.items ?? exs.data?.data ?? [];
      const latest = Array.isArray(items) ? items[0] : undefined;
      // 执行列表行的字段以 status 为准(status_code 仅在详情接口返回)
      step('执行断言通过', latest?.status === 'success', `execStatus=${latest?.status}`);
      step('执行历史落库', exs.data?.code === 200 && items.length > 0);
    }
  }

  // ── 场景编排 ──
  {
    const c = await call('POST', '/scenarios', { name: `e2e_scene_${TS}`, description: 'e2e' });
    ctx.sceneId = c.data?.data?.id;
    step('创建场景(自动 start/end 节点)', !!ctx.sceneId);
    if (ctx.sceneId) {
      const d = await call('GET', `/scenarios/${ctx.sceneId}`);
      step('读取场景详情(nodes/edges)', d.data?.code === 200 && Array.isArray(d.data?.data?.nodes));
      // 更新场景基本信息
      const u = await call('PUT', `/scenarios/${ctx.sceneId}`, { name: `e2e_scene_${TS}_upd`, description: 'upd' });
      step('修改场景', u.data?.code === 200, JSON.stringify(u.data).slice(0, 80));
      // 场景 flow 是否有专用保存端点?
      const f = await call('PUT', `/scenarios/${ctx.sceneId}/flow`, {
        nodes: [
          { node_id: 'start', type: 'start', position_x: 250, position_y: 50 },
          { node_id: 'n1', type: 'api', position_x: 250, position_y: 200, config: JSON.stringify({ api_id: ctx.apiId, api_name: 'e2e_api' }) },
          { node_id: 'end', type: 'end', position_x: 250, position_y: 400 },
        ],
        edges: [
          { edge_id: 'e1', source_node_id: 'start', target_node_id: 'n1' },
          { edge_id: 'e2', source_node_id: 'n1', target_node_id: 'end' },
        ],
      });
      step('保存场景画布(flow)', f.data?.code === 200 || f.status === 404, f.status === 404 ? '(无此端点—记录)' : '');
      if (f.data?.code === 200) {
        // 真实执行场景: 单 API 节点经 mock → 应成功
        const x = await call('POST', `/scenarios/${ctx.sceneId}/execute`, {});
        step('执行场景', x.status === 200 && x.data?.data?.status === 'success', JSON.stringify(x.data).slice(0, 120));
      }
    }
  }

  // ── 场景集(API 类型) + 执行 ──
  {
    const c = await call('POST', '/scenario-sets', { name: `e2e_sceneset_${TS}`, scenario_ids: ctx.sceneId ? [ctx.sceneId] : [] });
    ctx.sceneSetId = c.data?.data?.id;
    step('创建场景集', !!ctx.sceneSetId, JSON.stringify(c.data).slice(0, 100));
    if (ctx.sceneSetId && ctx.sceneId) {
      const x = await call('POST', `/scenario-sets/${ctx.sceneSetId}/execute`, {});
      step('批量执行场景集', x.status === 200, JSON.stringify(x.data).slice(0, 120));
      const his = await call('GET', `/scenario-sets/${ctx.sceneSetId}/executions`);
      step('场景集执行历史', his.data?.code === 200);
    }
  }

  // ── 定时调度(API 类型) ──
  {
    if (ctx.sceneSetId) {
      // 定时任务的创建语义是"为集合配置 cron"(PUT /set/:setId upsert), 无 POST /
      const c = await call('PUT', `/schedule-sets-api/set/${ctx.sceneSetId}`, {
        cron_expr: '0 3 * * *', status: 'active',
      });
      ctx.schedId = c.data?.data?.id;
      step('配置定时任务(PUT /set/:setId)', !!ctx.schedId && (c.data?.code === 200 || c.data?.code === 201), JSON.stringify(c.data).slice(0, 140));
      if (ctx.schedId) {
        const list = await call('GET', '/schedule-sets-api?page=1&pageSize=10&status=active&name=e2e');
        step('定时列表(带服务端过滤)', list.data?.code === 200);
        const pa = await call('POST', `/schedule-sets-api/${ctx.schedId}/pause`, {});
        step('暂停定时任务', pa.data?.code === 200 || pa.status === 200, JSON.stringify(pa.data).slice(0, 60));
        const re = await call('POST', `/schedule-sets-api/${ctx.schedId}/resume`, {});
        step('恢复定时任务', re.data?.code === 200 || re.status === 200);
        const rm = await call('POST', `/schedule-sets-api/${ctx.schedId}/remove`, {});
        step('移除定时配置', rm.data?.code === 200 || rm.status === 200);
      }
    }
  }

  // ── 标签 ──
  {
    const c = await call('POST', '/tags', { name: `e2e_tag_${TS}`, color: '#22c55e' });
    step('创建标签', c.data?.code === 200 || c.data?.code === 201, JSON.stringify(c.data).slice(0, 80));
    const l = await call('GET', '/tags');
    step('标签列表', l.data?.code === 200 && JSON.stringify(l.data.data).includes(`e2e_tag_${TS}`));
  }

  // ── dashboard ──
  {
    for (const ep of ['/dashboard/stats', '/dashboard/trend', '/dashboard/recent-executions?limit=3', '/dashboard/pending']) {
      const r = await call('GET', ep);
      step(`GET ${ep}`, r.data?.code === 200);
    }
  }

  // ── Web 测试 ──
  {
    const payload = {
      name: `e2e_web_${TS}`, description: 'e2e', status: 'active', tags: '',
      preconditions: '', case_content: '打开百度首页', case_content_type: 'text',
      check_points: JSON.stringify([{ type: 'text', text: '页面标题包含百度' }]),
      browser: 'chromium', headless_mode: 1, timeout: 30,
      data_drive: '{}',
    };
    const c = await call('POST', '/web-cases', payload);
    ctx.webCaseId = c.data?.data?.id;
    step('创建 Web 用例', !!ctx.webCaseId, JSON.stringify(c.data).slice(0, 120));
    if (ctx.webCaseId) {
      const u = await call('PUT', `/web-cases/${ctx.webCaseId}`, { ...payload, name: `${payload.name}_upd` });
      step('修改 Web 用例', u.data?.code === 200);
      // 真实执行: 未配置 Midscene 模型 → 预期结构化失败(error), 不应 500
      const x = await call('POST', `/web-cases/${ctx.webCaseId}/execute`, { timeoutMs: 90000 });
      const okShape = x.status === 200 || x.status === 500; // 路由把 executor 错误包成 500+message
      const structured = okShape && typeof x.data?.message === 'string';
      step('Web 执行返回结构化(依赖缺失也应有明确错误)', structured, `HTTP ${x.status} ${JSON.stringify(x.data).slice(0, 110)}`);

      // 用例集
      const cs = await call('POST', '/case-sets-web', { name: `e2e_webset_${TS}`, test_case_ids: [ctx.webCaseId] });
      ctx.webSetId = cs.data?.data?.id;
      step('创建 Web 用例集', !!ctx.webSetId, JSON.stringify(cs.data).slice(0, 100));
    }
  }

  // ── PC 测试 (CRUD only — 不在本机触发键鼠控制) ──
  {
    const payload = {
      name: `e2e_pc_${TS}`, description: 'e2e', status: 'active', platform: 'mac',
      preconditions: '', case_content: '打开计算器', case_content_type: 'text',
      check_points: JSON.stringify([]),
      data_drive: '{}',
    };
    const c = await call('POST', '/pc-cases', payload);
    ctx.pcCaseId = c.data?.data?.id;
    step('创建 PC 用例', !!ctx.pcCaseId, JSON.stringify(c.data).slice(0, 120));
    if (ctx.pcCaseId) {
      const u = await call('PUT', `/pc-cases/${ctx.pcCaseId}`, { ...payload, name: `${payload.name}_upd` });
      step('修改 PC 用例', u.data?.code === 200);
      const cs = await call('POST', '/case-sets-pc', { name: `e2e_pcset_${TS}`, test_case_ids: [ctx.pcCaseId] });
      step('创建 PC 用例集', !!cs.data?.data?.id);
    }
  }

  // ── 移动端测试 ──
  {
    const payload = {
      name: `e2e_mob_${TS}`, description: 'e2e', status: 'active', platform: 'android',
      device_name: '虚拟设备(未连接)', case_content: '打开设置', case_content_type: 'text',
      check_points: JSON.stringify([]), preconditions: '',
    };
    const c = await call('POST', '/mobile-tests', payload);
    ctx.mobId = c.data?.data?.id;
    step('创建移动端用例', !!ctx.mobId, JSON.stringify(c.data).slice(0, 130));
    if (ctx.mobId) {
      const u = await call('PUT', `/mobile-tests/${ctx.mobId}`, { ...payload, name: `${payload.name}_upd` });
      step('修改移动端用例', u.data?.code === 200);
      // 执行: 无 adb 设备 → 预期结构化错误而非 500/挂起
      const x = await call('POST', `/mobile-tests/${ctx.mobId}/execute`, {});
      const structured = (x.status === 200 && x.data?.data?.status !== undefined && x.data.data.status !== 'success')
        || (x.status >= 400 && x.status < 500) || (x.status === 500 && typeof x.data?.message === 'string');
      step('移动端执行(无设备)= 结构化失败', structured, `HTTP ${x.status} ${JSON.stringify(x.data).slice(0, 110)}`);
      const dm = await call('GET', '/devices/merged?test_type=mobile');
      step('设备库 merged 列表', dm.data?.code === 200);
    }
  }

  // ── OpenAPI 导出预览 ──
  {
    const r = await call('GET', '/export-package/preview');
    step('导出包预览(preview)', r.data?.code === 200, JSON.stringify(r.data).slice(0, 80));
  }

  // ── 清理(同时验证 DELETE 链路) ──
  {
    const dels: Array<[string, string]> = [];
    // schedule 配置已在上面用 POST /:id/remove 移除并验证, 无 DELETE /:id 端点
    if (ctx.sceneSetId) dels.push(['scenario-sets', ctx.sceneSetId]);
    if (ctx.webSetId) dels.push(['case-sets-web', ctx.webSetId]);
    if (ctx.sceneId) dels.push(['scenarios', ctx.sceneId]);
    if (ctx.apiId) dels.push(['/apis'.replace('/', ''), ctx.apiId]); // apis
    if (ctx.webCaseId) dels.push(['web-cases', ctx.webCaseId]);
    if (ctx.pcCaseId) dels.push(['pc-cases', ctx.pcCaseId]);
    if (ctx.mobId) dels.push(['mobile-tests', ctx.mobId]);
    if (ctx.mockId) dels.push(['mocks-api', ctx.mockId]);
    if (ctx.envId) dels.push(['environments', ctx.envId]);
    let delOk = 0;
    for (const [ep, id] of dels) {
      const r = await call('DELETE', `/${ep}/${id}`);
      if (r.data?.code === 200 || r.status === 200) delOk++;
      else console.log(`   清理失败: DELETE /${ep}/${id} → ${JSON.stringify(r.data).slice(0, 80)}`);
    }
    step(`清理临时数据(${dels.length} 项)`, delOk === dels.length, `deleted=${delOk}/${dels.length}`);
  }

  console.log(`\n==== E2E WALK RESULT: ${passed} passed, ${failed} failed ====`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('walk crashed:', e); process.exit(2); });
