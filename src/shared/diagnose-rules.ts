/**
 * 执行异常诊断引擎 (2026-08-29)
 *
 * 纯函数 + 规则库: 执行失败记录的错误特征 → 「原因解释 + 分步建议」。
 * 前端各执行记录详情区实时计算(不落库 — 规则迭代后历史记录也能重新诊断);
 * 后端 console 亦可 import 同一份规则打印建议。
 *
 * 规则按 priority 升序尝试(小者先), 返回 1 条主诊断 + 最多 2 条次要可能。
 * 命中判定宁缺毋滥: 无把握的输入不产出建议, 避免误导。
 */

export type TestKind = 'api' | 'web' | 'pc' | 'mobile' | 'scenario' | 'unknown';

export interface DiagnoseInput {
  /** 执行状态: error(异常)/failed(断言失败等) */
  status?: string | null;
  /** HTTP 状态码(接口类) */
  statusCode?: number | null;
  /** 错误信息全文 */
  errorMessage?: string | null;
  /**
   * 错误 cause 链文本 (2026-08-30)。
   * Node 的 "fetch failed" 只是外壳, 特征(ECONNREFUSED/ENOTFOUND/host:port)
   * 在 cause 里 — errorMessage 看不出特征时, 从这里匹配。
   */
  cause?: string | null;
  /** 实际请求 URL(变量替换后) — 用于识别未替换的 {{var}} */
  requestUrl?: string | null;
  /** 实际请求头 JSON — 用于识别 Authorization 里的 {{var}} */
  requestHeaders?: string | null;
  /** 测试类型 */
  kind?: TestKind;
}

export interface DiagnoseAdvice {
  code: string;
  title: string;
  /** 一句话原理, 尽量带上下文(如具体端口/变量名) */
  reason: string;
  suggestions: string[];
  severity: 'error' | 'warning';
}

interface DiagnoseRule {
  priority: number; // 小者先; 50-具体特征 / 100-类型特征 / 150-通用兜底
  code: string;
  test: (input: DiagnoseInput, msg: string) => boolean;
  build: (input: DiagnoseInput, msg: string) => DiagnoseAdvice;
}

/** 从 URL/请求头里找出未替换的 {{var}} 占位符名 */
function findUnreplacedVars(input: DiagnoseInput): string[] {
  const vars = new Set<string>();
  const sources = [input.requestUrl ?? '', input.requestHeaders ?? ''];
  for (const src of sources) {
    for (const m of src.matchAll(/\{\{(\w+)\}\}/g)) vars.add(m[1]);
  }
  return [...vars];
}

function firstMatch(msg: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m;
  }
  return null;
}

// ── 接口测试: 请求构造类(最具体, 优先) ──
const RULE_URL_MISSING: DiagnoseRule = {
  priority: 10,
  code: 'URL_MISSING',
  test: (i, msg) => /URL is required|请求地址|url.*required/i.test(msg) || (i.status === 'error' && /protocol.*https?/i.test(msg) && !i.requestUrl),
  build: () => ({
    code: 'URL_MISSING',
    title: '用例未配置请求地址',
    reason: '执行时没有可用的目标 URL — 用例主体动作里的地址为空',
    suggestions: [
      '打开「主体动作」tab, 在地址栏填写完整 URL',
      '若地址用 {{base}} 等环境变量拼接, 确认环境管理里该变量有值且已选中环境',
    ],
    severity: 'error',
  }),
};

// ⭐ 平台特有知识: 401/403 + 未替换变量 → 上游提取失败
const RULE_UNREPLACED_VAR: DiagnoseRule = {
  priority: 20,
  code: 'UNREPLACED_VAR',
  test: (i) => {
    const vars = findUnreplacedVars(i);
    return vars.length > 0 && (i.statusCode === 401 || i.statusCode === 403 || i.status === 'failed' || i.status === 'error');
  },
  build: (i) => {
    const vars = findUnreplacedVars(i);
    return {
      code: 'UNREPLACED_VAR',
      title: `请求中的变量未被替换: ${vars.map(v => `{{${v}}}`).join('、')}`,
      reason: '占位符原样发给了服务端(而非替换成实际值)— 通常意味着上游节点的提取规则失败, 或单用例执行时缺少提供该变量的上游',
      suggestions: [
        `在场景中: 检查上游节点「提取规则」的变量名与 JSON 路径是否正确(应提取为 ${vars.join('/')})`,
        '查看上游节点的实际响应, 确认提取路径指向的字段存在',
        '单独执行该用例时, 上游变量不可用属预期 — 请改在场景中执行, 或先手动执行上游用例',
      ],
      severity: 'error',
    };
  },
};

// ── 接口: HTTP 语义类 ──
const RULE_401_TOKEN: DiagnoseRule = {
  priority: 30,
  code: 'AUTH_TOKEN_INVALID',
  test: (i) => (i.statusCode === 401 || i.statusCode === 403) && (i.requestHeaders ?? '').toLowerCase().includes('authorization'),
  build: () => ({
    code: 'AUTH_TOKEN_INVALID',
    title: '认证被拒绝 (401/403)',
    reason: '请求携带了 Authorization 头但仍被拒 — token 已过期、非本环境账号, 或服务端鉴权规则变更',
    suggestions: [
      '重新执行上游登录节点获取新 token, 再执行本用例',
      '确认登录用的账号在被测环境有效',
      '若服务端鉴权近期变更, 核对所需的头名称/格式 (Bearer 前缀等)',
    ],
    severity: 'error',
  }),
};

const RULE_404: DiagnoseRule = {
  priority: 40,
  code: 'PATH_NOT_FOUND',
  test: (i) => i.statusCode === 404,
  build: () => ({
    code: 'PATH_NOT_FOUND',
    title: '接口路径不存在 (404)',
    reason: '服务端没有这个路径 — 接口改版、环境不一致, 或路径拼写有误',
    suggestions: [
      '核对被测服务的最新接口文档, 确认路径与请求方法',
      '确认当前选中环境指向的服务版本包含该接口',
      '检查路径是否多了/少了前缀 (如 /api)',
    ],
    severity: 'error',
  }),
};

const RULE_429: DiagnoseRule = {
  priority: 40,
  code: 'RATE_LIMITED',
  test: (i) => i.statusCode === 429,
  build: () => ({
    code: 'RATE_LIMITED',
    title: '被限流 (429)',
    reason: '请求频率超过了服务端(或本平台登录接口)的限流阈值',
    suggestions: [
      '等待 1 分钟后重试, 或降低批量/场景执行的频率',
      '平台自身接口被限流时: 本地调试可在 .env 设置 AUTH_RATE_MAX 后重启服务',
    ],
    severity: 'warning',
  }),
};

const RULE_5XX: DiagnoseRule = {
  priority: 60,
  code: 'SERVER_ERROR',
  test: (i) => (i.statusCode ?? 0) >= 500,
  build: (i) => ({
    code: 'SERVER_ERROR',
    title: `被测服务内部错误 (${i.statusCode})`,
    reason: '服务端处理该请求时自身出错 — 参数不合法触发服务端异常, 或服务存在缺陷',
    suggestions: [
      '查看被测服务日志定位堆栈',
      '检查请求体/参数是否符合接口约定(类型、必填)',
      '若参数无误, 该错误本身就是被测服务的缺陷, 可记录为 bug',
    ],
    severity: 'error',
  }),
};

// ── 通用网络类 ──
const RULE_ECONNREFUSED: DiagnoseRule = {
  priority: 50,
  code: 'ECONNREFUSED',
  test: (_i, msg) => /ECONNREFUSED|connection refused|ERR_CONNECTION_REFUSED/i.test(msg),
  build: (i, msg) => {
    // connect ECONNREFUSED 127.0.0.1:9999 → 提取 host:port; 兜底取请求 URL 的
    const m = msg.match(/ECONNREFUSED\s+(\S+)/i);
    let hostport = m?.[1]?.replace(/[.,)]+$/, '') ?? '';
    if (!hostport && i.requestUrl) {
      try { hostport = new URL(i.requestUrl).host; } catch { hostport = ''; }
    }
    return {
      code: 'ECONNREFUSED',
      title: hostport ? `目标服务未启动或端口不对: ${hostport}` : '目标服务未启动或端口不对',
      reason: `连接被拒绝 — ${hostport || '目标地址'} 上没有进程在监听(服务没起, 或端口写错)`,
      suggestions: hostport
        ? [
            `手动验证: curl http://${hostport} 是否可达`,
            `确认被测服务已启动且监听 ${hostport} 端口(注意容器端口映射)`,
            '地址若来自环境变量, 检查环境管理里该变量的值',
          ]
        : [
            '手动 curl 目标地址验证是否可达',
            '确认被测服务进程已启动、端口与 URL 一致',
            '地址若来自环境变量, 检查环境管理里该变量的值',
          ],
      severity: 'error',
    };
  },
};

const RULE_ENOTFOUND: DiagnoseRule = {
  priority: 50,
  code: 'ENOTFOUND',
  test: (_i, msg) => /ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED|name or service not known/i.test(msg),
  build: (_i, msg) => {
    // getaddrinfo ENOTFOUND api.example.com / getaddrinfo EAI_AGAIN xxx
    const m = msg.match(/getaddrinfo\s+\w+\s+(\S+)/i) ?? msg.match(/ENOTFOUND\s+(\S+)/i);
    const host = m?.[1]?.replace(/[.,)]+$/, '') ?? '';
    return {
      code: 'ENOTFOUND',
      title: host ? `域名/主机名无法解析: ${host}` : '域名无法解析',
      reason: host
        ? `DNS 查不到 ${host} — 目标地址没配置、域名写错, 或该内网域名需要 VPN`
        : 'DNS 解析失败 — 目标地址没配置、域名写错, 或本机 DNS/网络问题',
      suggestions: host
        ? [
            `核对地址里的 ${host} 拼写(注意多余空格/中文标点/缺协议头)`,
            `终端验证: nslookup ${host} 或 ping ${host}`,
            '内网域名确认已连接 VPN/内网',
            '若地址来自环境变量, 检查环境管理里该变量的值是否为空或写错',
          ]
        : [
            '核对目标地址拼写(注意多余空格/中文标点)',
            '终端执行 nslookup <域名> 验证解析',
            '内网域名确认已连接 VPN/内网',
          ],
      severity: 'error',
    };
  },
};

const RULE_TIMEOUT: DiagnoseRule = {
  priority: 70,
  code: 'ETIMEDOUT',
  test: (_i, msg) => /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|TimeoutError|timeout.*exceeded|exceeded.*timeout|timed out|aborted due to timeout|abort.*timeout/i.test(msg),
  build: (i) => ({
    code: 'ETIMEDOUT',
    title: '连接/响应超时',
    reason: '在限定时间内没有收到响应 — 服务处理慢、网络不通, 或用例 timeout 设置过小',
    suggestions: [
      '确认目标服务可达且响应正常(浏览器/curl 手动验证耗时)',
      '接口用例可调大「环境配置」里的超时时间',
      '偶发超时多为服务端负载问题, 可重试确认',
    ],
    severity: 'warning',
  }),
};

const RULE_ECONNRESET: DiagnoseRule = {
  priority: 70,
  code: 'ECONNRESET',
  test: (_i, msg) => /ECONNRESET|connection reset|socket hang up/i.test(msg),
  build: () => ({
    code: 'ECONNRESET',
    title: '连接被重置',
    reason: '请求过程中连接被对端关闭 — 服务正在重启、进程崩溃, 或中间代理干预',
    suggestions: [
      '确认被测服务没有在发布/重启窗口',
      '重试一次, 持续出现则查服务日志',
      '经过 Nginx 等代理时检查代理超时/拦截配置',
    ],
    severity: 'warning',
  }),
};

const RULE_TLS: DiagnoseRule = {
  priority: 60,
  code: 'TLS_ERROR',
  test: (_i, msg) => /certificate|self-signed|ERR_TLS|SSL|unable to verify/i.test(msg),
  build: () => ({
    code: 'TLS_ERROR',
    title: 'HTTPS 证书校验失败',
    reason: '目标服务使用自签/过期证书, Node 默认严格校验被拒',
    suggestions: [
      '在「环境管理」为该环境上传服务端证书',
      '内网自签服务也可将环境里的地址临时改为 http 验证',
    ],
    severity: 'warning',
  }),
};

// ── Web 专项 ──
const RULE_BROWSER_MISSING: DiagnoseRule = {
  priority: 30,
  code: 'BROWSER_MISSING',
  test: (_i, msg) => /Executable doesn't exist|browserType\.launch|Failed to launch/i.test(msg),
  build: () => ({
    code: 'BROWSER_MISSING',
    title: 'Playwright 浏览器驱动未安装',
    reason: '找不到可执行浏览器 — 驱动未下载或路径配置不符',
    suggestions: [
      '在项目根目录执行: npm run setup:drivers 安装浏览器驱动',
      '已安装仍报错时检查 PLAYWRIGHT_BROWSERS_PATH 环境变量',
    ],
    severity: 'error',
  }),
};

const RULE_MODEL_CONFIG: DiagnoseRule = {
  priority: 30,
  code: 'MODEL_CONFIG',
  test: (_i, msg) => /midscene|openai|api key|401.*model|model.*401|insufficient|quota|balance/i.test(msg),
  build: () => ({
    code: 'MODEL_CONFIG',
    title: 'AI 模型调用失败',
    reason: 'Midscene 调用大模型被拒 — API Key 无效/额度不足, 或模型服务超时',
    suggestions: [
      '打开「设置 → 模型配置」核对 API Key 与模型名称',
      '确认账户额度/余额充足',
      '模型服务偶发超时可重试',
    ],
    severity: 'error',
  }),
};

// ── PC 专项 ──
const RULE_TCC_PERMISSION: DiagnoseRule = {
  priority: 30,
  code: 'TCC_PERMISSION',
  test: (_i, msg) => /screen recording|accessibility|辅助功能|屏幕录制|not authorized|permission/i.test(msg) && (msg.includes('mac') || msg.includes('darwin') || true),
  build: () => ({
    code: 'TCC_PERMISSION',
    title: '系统权限未授予 (屏幕录制/辅助功能)',
    reason: 'macOS 需要给终端/Node 授予屏幕录制与辅助功能权限, 否则截图与键鼠控制全部失效',
    suggestions: [
      '系统设置 → 隐私与安全性 → 屏幕录制: 勾选运行平台的终端 App',
      '系统设置 → 隐私与安全性 → 辅助功能: 同样勾选',
      '授权后需完全退出并重启终端再启动平台',
    ],
    severity: 'error',
  }),
};

// ── Mobile 专项 ──
const RULE_ANDROID_HOME: DiagnoseRule = {
  priority: 20,
  code: 'ANDROID_HOME',
  test: (_i, msg) => /ANDROID_HOME|ANDROID_SDK_ROOT/i.test(msg),
  build: () => ({
    code: 'ANDROID_HOME',
    title: 'Android SDK 环境变量未配置',
    reason: '设备探测依赖 adb, 而 adb 需要 ANDROID_HOME/ANDROID_SDK_ROOT 定位 SDK',
    suggestions: [
      '在 ~/.zshenv 加入: export ANDROID_HOME=$HOME/Library/Android/sdk 与 export PATH=$PATH:$ANDROID_HOME/platform-tools',
      '执行 source ~/.zshenv 后重启平台服务',
      '没有 SDK 时安装 Android Studio (或仅装 command-line tools) 后再配置',
    ],
    severity: 'error',
  }),
};

const RULE_NO_DEVICE: DiagnoseRule = {
  priority: 30,
  code: 'NO_DEVICE',
  test: (_i, msg) => /Unable to get connected.*device|no devices|设备.*未连接|device not found|没有.*设备/i.test(msg),
  build: () => ({
    code: 'NO_DEVICE',
    title: '没有可用的移动设备',
    reason: '设备列表为空 — 未连接真机/模拟器, 或 adb 授权弹窗未确认',
    suggestions: [
      '终端执行 adb devices 确认设备已连接且状态为 device(非 unauthorized)',
      '手机上确认「允许 USB 调试」授权弹窗',
      '在「设备配置」tab 重新选择设备',
    ],
    severity: 'error',
  }),
};

const RULE_DEVICE_BUSY: DiagnoseRule = {
  priority: 30,
  code: 'DEVICE_BUSY',
  test: (_i, msg) => /设备.*忙|正在执行其他任务|device.*(busy|occupied)|409/i.test(msg) && /device|设备/i.test(msg),
  build: () => ({
    code: 'DEVICE_BUSY',
    title: '设备被占用',
    reason: '目标设备已有执行中的用例(同一设备同时只能跑一个)',
    suggestions: [
      '等待当前执行完成后再试',
      '检查是否有残留的 running 执行占用(执行历史里可确认)',
    ],
    severity: 'warning',
  }),
};

// ── 断言失败兜底(接口) ──
const RULE_ASSERT_FAIL: DiagnoseRule = {
  priority: 120,
  code: 'ASSERT_FAIL',
  test: (i) => i.status === 'failed',
  build: (i) => {
    const m = firstMatch(i.errorMessage ?? '', [/期望[^\n]*实际[^\n]*/]);
    return {
      code: 'ASSERT_FAIL',
      title: '检查点(断言)未通过',
      reason: m ? `断言差异: ${m[0].slice(0, 80)}` : '响应与用例配置的检查点不符 — 可能是被测行为变化, 或检查点期望值过期',
      suggestions: [
        '展开响应详情, 对比「期望值 vs 实际值」定位差异字段',
        '被测行为确已变更时, 更新用例检查点的期望值',
        '若属预期外差异, 这正是要发现的缺陷 — 保留记录提 bug',
      ],
      severity: 'warning',
    };
  },
};

// ── 通用兜底 ──
const RULE_GENERIC: DiagnoseRule = {
  priority: 200,
  code: 'GENERIC_ERROR',
  test: (i) => i.status === 'error' || i.status === 'failed',
  build: (i) => ({
    code: 'GENERIC_ERROR',
    title: '执行异常(未识别的错误模式)',
    reason: (i.errorMessage ?? '无错误信息').slice(0, 120),
    suggestions: [
      '查看执行历史中的完整请求/响应与堆栈详情',
      '控制台(服务端日志)有该异常的完整堆栈可对照',
      '可将错误信息反馈给平台维护者, 沉淀进诊断规则库',
    ],
    severity: 'error',
  }),
};

const RULES: DiagnoseRule[] = [
  RULE_URL_MISSING,
  RULE_UNREPLACED_VAR,
  RULE_ANDROID_HOME,
  RULE_401_TOKEN,
  RULE_404,
  RULE_429,
  RULE_BROWSER_MISSING,
  RULE_MODEL_CONFIG,
  RULE_TCC_PERMISSION,
  RULE_NO_DEVICE,
  RULE_DEVICE_BUSY,
  RULE_ECONNREFUSED,
  RULE_ENOTFOUND,
  RULE_TLS,
  RULE_5XX,
  RULE_TIMEOUT,
  RULE_ECONNRESET,
  RULE_ASSERT_FAIL,
  RULE_GENERIC,
];

/**
 * 诊断入口: 返回 [主诊断, ...次要可能(≤2)]。
 * 输入不足以判断(无错误信息且状态非失败)时返回 []。
 */
export function diagnose(input: DiagnoseInput): DiagnoseAdvice[] {
  // errorMessage + cause 合并成一个匹配文本 — "fetch failed"(外壳) +
  // "getaddrinfo ENOTFOUND api.x.com"(cause) 必须能命中 ENOTFOUND 规则
  const msg = [String(input.errorMessage ?? ''), String(input.cause ?? '')].filter(Boolean).join('\n');
  if (!msg && input.status !== 'failed' && input.status !== 'error') return [];
  if (input.statusCode === 200 && input.status === 'success') return [];

  const hits: DiagnoseAdvice[] = [];
  for (const rule of [...RULES].sort((a, b) => a.priority - b.priority)) {
    try {
      if (rule.test(input, msg)) hits.push(rule.build(input, msg));
    } catch { /* 单条规则异常不影响其余 */ }
    if (hits.length >= 3) break;
  }
  // 去重(GENERIC 兜底排最后)
  return hits.filter((h, idx, arr) => arr.findIndex(x => x.code === h.code) === idx);
}
