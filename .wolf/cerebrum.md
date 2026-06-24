# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-05-17

## User Preferences

- **95% 把握铁律**：修改代码前必须有 95% 以上的把握。如果没有达到这个确定性，必须先问用户确认方案再动手。不确定时问 > 盲目改。这是铁律，不可违反。
- **CSS 组件复用铁律**：发现相同或相似的组件样式（如 Header、按钮、卡片、表格等）时，必须抽取到公共 CSS 文件（如 `detail-components.css`、`App.css`），禁止在各页面 CSS 中重复定义。公共样式放在 `src/client/styles/` 目录下，页面级 CSS 只保留该页面特有的样式。违反此原则会导致：1）样式不一致；2）维护成本翻倍；3）主题切换时遗漏某些页面。
- **四种测试类型后端必须完全隔离**：API/Web/移动端/PC测试的数据必须通过独立表和独立路由管理，不共用表、不共用路由。test_type 字段不能作为隔离手段，只能作为辅助字段。原型设计与此冲突时，以本原则为准。
- **前端组件通过 API_PATH_MAP 调用隔离后端**：共享组件（ScenarioList, ScenarioDetail, ScenarioSetList, ScenarioSetDetail）使用 API_PATH_MAP 常量，根据 testType 调用对应的 /scenarios、/scenarios-web、/scenarios-pc、/scenarios-mobile 等端点。路由跳转也通过 ROUTE_PATH_MAP 常量映射。
- **environments 表无 test_type 字段**：环境（DB 连接/SSL 证书/环境变量）是 4 种测试类型共享的基础设施，必须保持为单一共享表，不应加 test_type 列做隔离。
- **(2026-06-07) 页面展示功能 vs 执行能力 解耦**：操作类按钮（上/下线、删除、推送、停止、导出等）不要根据"是否配置了某些属性"来决定显示/隐藏，而是**始终显示**让用户看得见能力,点击时再校验是否符合执行条件,不符合时给清晰提示(toast 警告 + 自动引导到编辑表单)。理由:用户原话"别因为某些属性没设置导致页面展示的内容和操作不同"。**错误模式**:`canPush = test_type === 'web' && hasSshConfig` 把"配置齐全"和"类型支持"合在一起,部分用户看不到这个能力。**正确模式**:可见性只看"类型是否支持"(`test_type === 'web'`),执行前再做"配置是否齐全"校验,失败时不静默 fail,给 toast + 引导路径

## Key Learnings

- **CSS 组件复用铁律**：发现相同或相似的组件样式时，必须抽取到公共 CSS 文件，禁止在各页面 CSS 中重复定义。公共样式放在 `src/client/styles/` 目录下，页面级 CSS 只保留该页面特有的样式。
- **ad-section-head 边框延伸技巧**：当 `.ad-section` 有 `padding` 时，`.ad-section-head` 需要 `margin-left/right/top: -padding` 来使边框延伸到整个宽度。
- **页面级 CSS 禁止全局覆盖共享类**：CaseSetDetail.css 中 `.detail-action-bar`（无父类前缀）是全局覆盖，影响所有页面。页面级 CSS 中覆盖共享类必须加父类前缀（如 `.case-set-detail .detail-action-bar`）。发现时应删除或加前缀。同理 WebCaseDetail.css/PcCaseDetail.css 的 `.web-case-detail .detail-action-bar` 虽有前缀，但 `position: fixed` 模式已弃用。

- **Project:** auto-test-platform
- **Description:** 自动化测试平台 - 支持接口/Web/移动端/PC端自动化测试
- **basePath prop pattern**: 共享列表页组件（ScenarioList, MockList 等）通过可选 `basePath` prop（默认 `/api-test`）实现路由复用，不同测试类型传入不同 basePath
- **API_PATH_MAP 前端隔离模式**: 共享组件前端用 API_PATH_MAP/ROUTE_PATH_MAP 常量根据 testType 映射到对应后端 API 和前端路由，避免硬编码
- **MENUS_BY_TYPE 动态侧边栏**: Layout.tsx 通过 `location.pathname` 前缀判断当前测试类型，动态选择对应的菜单列表
- **移动端执行器抽象**: Android 用 ADB (keyevent, input tap/text/swipe)，iOS 用 WDA HTTP API (/wda/tap, /wda/keys, /wda/homescreen)，通过 platform 字段分发
- **Midscene 参考架构**: AndroidDevice extends AbstractInterface (ADB+appium-adb), IOSDevice extends AbstractInterface (WebDriverAgent)，共享通用操作，平台特有操作各自实现
- **展开行表格嵌套列宽对齐**: 场景集执行记录展开行用父表格结构直接延伸 `<tr>` 而非嵌套 `<table>`，列宽自然继承父表；空列用 `visibility: hidden` 保持宽度；子行用 `td:first-child { border-left: 3px solid var(--primary) }` 区分父子层级
- **共享资源表不应带 test_type 字段**: environments（DB连接/SSL/变量）等被 4 种测试类型共用的资源表，无 test_type 字段。带 test_type 列的表必须能按测试类型独立查询，否则应拆为专用表。
- **Node.js VM 沙箱硬化模式**: 用 `node:vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })` + `new vm.Script(code).runInContext(sandbox)` 替代 `new Function(...keys, body)`。`codeGeneration.strings:false` 阻断沙箱内 `eval()` / `new Function()` / `Function.prototype.constructor`，从而封堵 `({}).constructor.constructor('return process')()` 经典逃逸。脚本输出用 `Promise.race([promise, timeoutPromise])` 二次保险（vm.Script 的 timeout 只覆盖同步段）。`setVar`/`getVar` 闭包持有 host 端 `scriptVars`，结果通过 `result.vars` 回传，保持 API 兼容。
- **Midscene `overrideAIConfig` 运行时重载模式**: `MIDSCENE_*` 环境变量只在 `ModelConfigManager.initialize()` 启动时读一次,运行中改 process.env 不会生效。Midscene 暴露 `overrideAIConfig(envMap, extendMode?)` 强制重建 global ModelConfigManager。**`extendMode: true` 保留已有 env 值**(例如 Docker 设置的 OPENAI_API_KEY),只覆盖传入的键,避免误清空。实操:从 DB 读 per-user 配置,buildEnvMap 时跳过 null/空字符串/纯空格,直接 set `process.env[k] = v` 然后 await `overrideAIConfig(map, true)`,这样保留 ENV-var 默认值 + 注入用户覆盖值。web/pc/mobile executor 都在 case 起始调用一次,下次执行即生效

## Do-Not-Repeat

- [2026-06-15] 首页 UI 布局改动(去掉 kanban 卡片)被用户回滚: 前端页面布局/视觉改动前必须先确认用户意图,不要擅自删除 UI 元素。后端逻辑修复(统计一致性)可以独立提交,不要和前端 UI 改动混在一起
- [2026-05-26] Agent tool API Error 400: 不要用 Agent 子代理探索文件，直接 Read/Grep 更可靠
- [2026-05-26] WebFetch 对 github.com 失败: 克隆 GitHub 仓库用 `git clone --depth 1` 而非 WebFetch
- [2026-05-27] PC/Web 共用 web-cases 表和路由导致命名混乱: PC测试应独立表 + /pc-cases 路由，Web测试用 /web-cases
- [2026-06-01] environments 表加了 test_type 字段但 CREATE TABLE 没定义该列: 加字段前必须同步更新 CREATE TABLE 和迁移脚本，否则运行时报 SqliteError。共享资源表（environments）不应加 test_type
- [2026-06-01] mock_endpoints / batch_reports 拆表时,4 个新 mocks-{api,web,pc,mobile} / batch-reports-{api,web,pc,mobile} 文件需在 db/mocks.ts / db/batch-reports.ts 删除前完成。routes/mocks.ts 也要同步删除,否则会引用已删除的 db 模块。mock-proxy.ts / mock-engine.ts 需改为 UNION 4 张表查询并按 _source 路由 incrementMockHit 到正确表
- [2026-06-01] recreateTableWithoutTestType 用 PRAGMA table_info 只映射 {name,type} 丢失 PK/NOT NULL/DEFAULT 约束,导致 apis 等 6 张表失去 PRIMARY KEY,child 表引用时 'foreign key mismatch' 报 500。修复:必须用完整 {name,type,pk,notnull,dflt_value} 重建 colDefs,且对已损坏的表必须用硬编码 CREATE TABLE 恢复(PRAGMA 无法找回丢失的约束)
- [2026-06-01] PRAGMA table_info 的 dflt_value 会剥掉表达式外层括号: Schema 写的是 DEFAULT (datetime('now', '+8 hours')),但 PRAGMA 返回 datetime('now', '+8 hours')（无外层括号）。若 buildColumnDefinitions 直接拼成 `DEFAULT datetime(...)` 会报 "near (: syntax error"。修复:在 DEFAULT 子句拼接时检查 dv 是否以 ( 开头且包含 (,若是则用 (${dv}) 包裹
- [2026-06-01] 页面级按钮基类（如 .wcase-btn/.mtd-btn/.scenario-btn）定义在 page CSS 中且晚于 App.css 加载，同特异性下会覆盖全局 button 规则。要让全局共享 button.execute-btn（specificity 0,1,1）可靠覆盖基类背景/文字，应用 `button.execute-btn` 而非 `.execute-btn`，且需要先从 page CSS 移除冗余的 execute 专用规则（.wcase-btn.primary / .mtd-btn-exec）
- [2026-06-02] 不要用 `new Function(...keys, body)` 实现 JS 沙箱: `Function` 构造器在 outer realm，可通过 `({}).constructor.constructor('return process')()` 逃逸。所有 user-script 沙箱必须用 `node:vm.createContext(obj, { codeGeneration: { strings: false } })` + `runInContext` 替代
- [2026-06-02] vm.Script 的 `timeout` 选项只覆盖同步段,`await new Promise(r => setTimeout(r, 10000))` 不会触发。必须用 `Promise.race([scriptPromise, setTimeout-reject])` 加 wall-clock 硬超时
- [2026-06-03] routes 模块中 `authMiddleware` 不会跳过验证，调试时不能用 `(req, _res, next) => { req.user = ... }` 注入用户（会被覆盖且 `Authorization` header 缺失直接 401）。E2E 路由测试必须用 `signToken({userId, account})` 生成真 token，并通过 `Authorization: Bearer <token>` 头传入
- [2026-06-03] log 表（web_case_logs/pc_case_logs/mobile_test_logs）被 db 模块引用但 db/index.ts 从未 CREATE TABLE，POST /:id/execute 必报 "no such table"。Phase 1 修复：db/index.ts 必须同时建 cases 表 + 关联 logs 表 + 关联 executions 表，缺一不可
- [2026-06-03] 7 阶段 NL 重构只改了后端 parser(phase 7 `nl-steps.ts` + phase 2 smoke test),前端 step 编辑器(WebCaseDetail / PcCaseDetail / MobileTestDetail)仍带 `action` 下拉 + 类型化条件 UI,声称"完成"属汇报失实。教训:跨前后端的能力变更,前端 UI 也必须列入"完成"判定,不能只看后端 type check + smoke test 通过。下次重构 NL 化必须同步重构前端 3 个详情页
- [2026-06-03] 完成判定的硬清单:每次声明某阶段"完成"前,必须逐项核对 a) 后端 type check 通过、b) 前端 type check 通过、c) 涉及的 DB 表有迁移脚本、d) 涉及的 API 端点有 e2e 烟测、e) **用户可见 UI 面都被触达**。"通过 type check"≠"通过完成判定"。汇报时要列出每项 check 的具体证据,不能合并为"测试通过"
- [2026-06-03] 数据清空迁移(`DELETE FROM xxx`)是用户的"明确指令,不做向后兼容"路径,不是失职。~~听到"清掉旧数据"就要:1) 读 FK 定义确认 CASCADE 是否自动清子表;2) 用 `db.exec` 在 migration 列表末尾跑一次 DELETE;3) 注释里写明"不迁移,用户已确认"。~~ **修正(2026-06-04):这一条是错的,代价是清空用户所有 web/pc/mobile 用例。** 任何 `DELETE FROM <用户数据表>` 在 migration 脚本里都是红线:1) 用户从未在当次会话明确说"删除我所有用例",这类指令不能脑补;2) 字段重命名/列类型变更应通过 ALTER TABLE + 数据迁移完成,不动行;3) 即使用户说"清掉旧的",也必须先 export 备份,再 DELETE,而不是"标注一下注释就 DELETE"。db/index.ts 第 1231-1237 行的 3 行 DELETE 已移除,以后任何破坏性迁移必须先和用户当面确认
- [2026-06-03] "passed"等执行态 UI 字段的最佳实践:写入时 strip(`const { passed: _, ...rest } = cp; JSON.stringify(rest)`),读取时从 `GET /:id/executions?limit=1` 的 result.checkpoints 数组按 index 回填。**不**写回数据库,避免把瞬时执行态污染持久层。回填源用最新一条 execution 即可,不需要全量历史
- [2026-06-04] ESM 模块里 `import { chromium } from 'playwright'` 在 module body 之前就求值,触发时 `PLAYWRIGHT_BROWSERS_PATH` 还没设好,`chromium.executablePath()` 锁死错误路径 → 浏览器启动报"Executable doesn't exist"。**修法:把 `import` 改成 dynamic(`async function getPW() { return _pw ??= await import('playwright') }`),并在 setupBrowser 内部 await 它**。**前导代码设 env var 没用** —— ESM 会把所有静态 import hoist 到顶部,"先设 env 再 import"在 ESM 里做不到
- [2026-06-04] Playwright `chromium.launch({ channel: 'chromium' })` 的 channel 强制走 Google Chrome for Testing 缓存,**忽略 PLAYWRIGHT_BROWSERS_PATH**。用户配置了 `drivers/` 想用项目自带的 chromium build,必须用默认 `chromium.launch({ headless })`,不要传 channel
- [2026-06-04] ESM 模块不要混用 `require()`(即使只是 `require('node:fs')`),会报 "Cannot determine intended module format because both 'require' and top-level await are present"。改用 `import { existsSync } from 'node:fs'`
- [2026-06-04] `tsx watch` 在 zsh 里启动必须给 glob 参数加单引号,否则 zsh 会提前展开(`--ignore vite.config.ts.timestamp-*` → 文件不存在 → 参数丢失 → tsx 行为异常)。用 `bash -c "exec npx tsx watch --ignore 'vite.config.ts.timestamp-*' src/server/index.ts"` 或写 wrapper 脚本
- [2026-06-04] Vite 在 dev 模式会持续创建/删除 `vite.config.ts.timestamp-*.mjs` 文件,tsx watch 会因为这些文件 change/unlink 反复重启,**死循环**。启动 dev server 时必须 `--ignore 'vite.config.ts.timestamp-*'`,否则会一直 Restarting... 端口永远起不来
- [2026-06-04] dev server 启动失败时,浏览器"点击执行后页面跳转到日志页但什么都没发生"是典型症状 —— 前端跳转是 React 客户端 state 变化,不依赖后端;但 `POST /:id/execute` 调用会失败。**先 `curl /api/health` 确认后端在跑**,再排查浏览器启动问题。dev server 日志重定向到文件(`> /tmp/dev-server.log 2>&1 &`),`tail -f` 排查更直接
- [2026-06-05] `apiFetch<T>('PUT', ...)` 拿到 `ApiResponse<T>`,其 `data?: T` 字段是 `T | undefined`,**不是** `T | null` (PUT 响应里后端可能根本不返回 data)。PUT 回调里直接 `setForm(formFromRow(res.data))` 会报 "undefined is not assignable to T | null"。所有 PUT/POST 路径的 `res.data` 使用都应用 `?? null` 兜底;只对 GET 路径按 `res.data ?? []` / `?? null` 等具体 fallback 写
- [2026-06-07] JSX 属性值嵌套引号: `title="..."重连/升级"..."` JSX 解析器会在中间"重连/升级"上认为属性已结束 → 报 "JSX expressions must have one parent element" + 一连串 > 期望错误。**修法:外层 attribute 用单引号 `title='..."..."...'`,或用 `{`"..."}` 把引号包成 JSX 表达式**。同样的坑出现在 `<button title="...">...</button>` 类字面量里。Tip:TypeScript 报错行号可能离真实错误位置差 100+ 行,grep "内层有 ASCII 双引号的中文短语" 比看行号快
- [2026-06-07] 泛型 helper `function f<T>(d: T): T { return { ...d, new_field: x } as T }` 在 TS 5+ 会报 "Conversion ... may be a mistake because neither type sufficiently overlaps"。修法:**显式写出 return type 而非用 `as T`**,比如 `Omit<T, 'a'|'b'> & { has_a: boolean; has_b: boolean }`。这样 TS 能验证返回值确实是这个更窄的类型,而不是强行 cast。模式适用于 "strip secret 字段 + 加 has_* 布尔" 类场景
- [2026-06-07] AgentInfo modal 想用 SSH 字段(非敏感: host/user/auth_type/port)去 gate 按钮,但 modal payload 只返设备核心字段。**不要**用 `(info as unknown as { ssh_host?: string }).ssh_host ?? ''` 这种 cast hack(违反类型契约、未来字段加进来更乱)。正解:server `/api/devices/:id/agent-info` 端点把 `ssh_host / ssh_port / ssh_user / ssh_auth_type / os_type` 加到 response,client 在 AgentInfo interface 上加对应字段。`has_ssh_password` / `has_ssh_private_key` 这种布尔保持,真密文不返
- [2026-06-07] modal/container 内的主按钮:hover 必须显式重写 `background` 和 `color`,不能只 `opacity: 0.9`。外层 `.device-list__modal-actions button:hover` (特异性 0,2,1) 会赢过 `.device-list__btn--primary` (0,2,0),把蓝底改回 #f9fafb,白字配白底消失。**修法**:`.device-list__modal-actions .device-list__btn--primary:hover { background: var(--primary); opacity: 0.9; }` 让特异性 0,3,0 赢。**模式**:任何 modal/action 区域里带 modifier 类(`--primary` / `--danger`)的按钮,hover 态都要 explicit 重写颜色,不能依赖基础态的颜色
- [2026-06-15] Midscene `html-and-external-assets` 格式的报告必须整体复制(含 screenshots/ 子目录),不能只 copyFile index.html。web-executor 已用 `fs.cp(srcDir, dstDir, {recursive:true, force:true})`,pc-executor 仍用 `fs.copyFile` 导致截图黑屏。**模式**:任何 executor 的 `copyMidsceneReport` 必须复制整个目录树,不是单文件
- [2026-06-18] CodeMirror 内容区在 dark 主题下仍是白底:`@uiw/react-codemirror` 的 `theme` prop 默认 `'light'`,该 base theme 强制 `.cm-content` 背景白色,**胜过**通过 `extensions=[oneDark]` 注入的主题扩展(extension 只改 syntax/gutter,改不动 base bg)。**正解**:把当前主题字符串 `'light'|'dark'` 直接传给 `<CodeMirror theme={theme} />` 让 @uiw 内部 oneDark theme 全套接管 bg+fg。**反模式**:在 extensions 数组里手动 unshift `[oneDark, ...exts]` —— 永远会被 base light theme 盖住。封装组件 `src/client/components/ThemedCodeMirror.tsx` 已统一接管,业务代码不再 import `@uiw/react-codemirror` 或 `@codemirror/theme-one-dark`
- [2026-06-18] `.tab-nav` / `.detail-tabs` 出现垂直滚动条:`overflow-x: auto` 在某些浏览器里会让另一个轴 computed 成 `auto`,border-bottom + active tab 的 2px indicator 触发竖向溢出 → 出竖向滚动条。**修法**:`overflow-y: hidden` 显式锁死。模式:任何横向滚动的 tab/工具栏,都要显式 `overflow-y: hidden`,不要让浏览器自己决定
- [2026-06-18] 详情页 `ad-section` 模式:`ad-section-head` 自带 `padding: 12px 16px`,但 body 内容(rules-list / 按钮组等)**不会自动继承 16px 横向 padding**,会贴左。**修法**:body 用 `<div className="ad-section-fill">`(已定义 `padding: 16px`)包裹,否则按钮和列表会和 head 的 label 错位
- [2026-06-18] 表格宽度自动撑满 + 列挤压隐形:`table { width: 100% }` + `input { width: 100% }` 会让浏览器把短名列拉到全宽(出现 X 按钮溢出),长列被挤到看不见。**正解**:`table { width: auto; max-width: 100% }` + `input { width: 140px; min-width: 140px }`(或按内容用 ch 单元)。模式:**表格内容自适应、容器 overflow-x:auto 出滚动条**,而不是"表格永远 = 容器宽"
- [2026-06-18] Dark theme 边框隐形:`--border: #27272a` on `--surface: #18181b` 的亮度差 <2%,肉眼几乎看不到。**正解**:dark theme `--border` 至少 `#3f3f46`(亮度差 ~25%),`--border-subtle` 至少 `#2a2a30`。亮度差参考:`#27272a ≈ 9% L`,`#3f3f46 ≈ 25% L`,`#52525b ≈ 35% L`。任何"边框在深色主题看不见"的 bug 先 grep `--border:` 的十六进制值
- [2026-06-18] 项目滚动条样式跟主题:在 App.css 顶部加全局 `::-webkit-scrollbar` (width/height 8px, thumb `var(--border)`, hover `var(--fg-tertiary)`, track transparent, 4px padding via background-clip) + Firefox `scrollbar-width: thin; scrollbar-color: var(--border) transparent`。**反模式**:每个组件自己写一套 `::-webkit-scrollbar` 覆盖(PcCaseDetail / WebCaseDetail 之前有),会和全局打架。统一到 App.css,删除组件级 override
- [2026-06-18] 详情页外框模式对齐列表页:列表页 `.alist` 是 `background: var(--surface); overflow: hidden` 没有 border,直接填满 `.sys-content`。详情页 `.api-detail-card` / `.scenario-detail-card` / `.sset-card` 之前有 `border: 1px solid var(--border)` + `border-bottom: none`(3 边框),dark 主题边框颜色加深后(bug-189)从隐形变显眼,显得和列表页不一致。**正解**:删除所有详情页外层 card 的 border 跟 margin-bottom,让详情页就是 `background: var(--surface)` 的平板填满 content 区域,跟列表页 `.alist` 同款。模式:**全局只有一种"页面容器"模式,列表/详情共用,不要给详情页加额外的"卡片框"**

## Decision Log

- **2026-05-26**: 移动端测试模块采用 stub 执行器，先实现接口和分发框架，后续再对接真实 Appium/Midscene
- **2026-05-26**: 共享页面（场景、定时、报告、Mock、环境）通过 basePath prop 复用，而非为移动端创建独立副本
- **2026-05-27**: 四种测试类型后端完全隔离原则：API测试用 apis 表 + /apis，Web测试用 web_test_cases 表 + /web-cases，PC测试用 pc_test_cases 表 + /pc-cases，移动端用 mobile_test_cases 表 + /mobile-tests。前端共享组件通过 testType prop + test_type 查询参数区分数据。
- **2026-05-28**: 前端共享组件隔离模式升级：场景/场景集等前端组件不再依赖 test_type 查询参数，改用 API_PATH_MAP 常量直接映射到隔离端点（/scenarios, /scenarios-web, /scenarios-pc, /scenarios-mobile），避免后端再按 test_type 过滤
- **2026-05-31**: 调度器重构：node-cron 替代 30 秒轮询，场景集粒度调度（schedule_sets 表），启动时加载所有 active 任务创建 cron job，pause/resume/remove/upsert/configure 接口同步调用 scheduler 方法
- **2026-06-01**: environments 表去掉 test_type 字段。理由：环境是 4 种测试类型共享的基础设施（DB 连接/SSL/变量），不应按 test_type 隔离。从 db/routes/前端/类型定义中全链路移除 test_type。
- **2026-06-01**: 四种测试类型隔离完整审计——已隔离：`web_test_cases` / `pc_test_cases` / `mobile_test_cases` / `scenarios_web` / `scenarios_pc` / `scenarios_mobile` / `scenario_sets_web` / `scenario_sets_pc` / `scenario_sets_mobile`。未完全隔离（API 端仍是共享表+test_type 过滤）：`apis`、`scenarios`、`scenario_sets`、`mock_endpoints`、`batch_reports`。待后续拆分为 `apis_api` / `scenarios_api` / `scenario_sets_api` 等独立表（迁移成本较高，列入后续重构）。
- **2026-06-01**: 彻底移除 test_type 字段（9 阶段重构完成）。所有 4 种测试类型的后端数据通过独立表+独立路由完全隔离：mock_endpoints 拆为 mock_endpoints_{api,web,pc,mobile},batch_reports 拆为 batch_reports_{api,web,pc,mobile},mock 代理 UNION 4 张表查询并按 _source 路由 incrementMockHit 到正确表。Phase 1 DB migration 用 recreateTableWithoutTestType 函数（临时表名加 timestamp+random 避免冲突，PRAGMA foreign_keys OFF/ON 包裹以避免 FK 引用阻塞）。
- **2026-06-03**: Phase 7 补救方案：3 个详情页 NL 化 + `nlStepToMobileAction` 反向桥 + DB `DELETE FROM` 迁移清旧数据 + `passed` UI 字段从最新执行回填（不写回 DB）。核心约束"不能造成功能不可用"通过端到端 smoke test 25/25 守住
- **2026-06-05**: Midscene 模型配置采用 per-user 表 + 立即生效模式(用户选择)。理由:(1) 单机开发环境,per-user 隔离比全局配置更可调试;(2) overrideAIConfig 接受 envMap,save 后立即调用一次 + executor 启动时再调一次,双保险,无需重启;(3) Insight/Planning 段位独立配置允许用户用便宜模型做元素查询、用强模型做规划,节省 token。已知限制:process-global, 并发多用户用例时最后一次保存的模型生效(单机场景不构成问题)
- **2026-06-05**: 浏览器配置（Web 测试）从「每用例表单」迁移到「每用户配置页」。理由:driver_path / user_data_dir / downloadsPath / auto_download 等都是"环境级"配置,不应该每用例重复填。WebCaseDetail 完全删 driverPath + closeBrowserAfterExecution 两字段,新页面 `/web-test/browser-config` 集中 9 个 Playwright launch options（driver_path / executable_path / user_data_dir / accept_downloads / download_dir / auto_download / chromium_sandbox / close_browser_after_execution / default_timeout_ms）,只挂 web-test 侧栏（api/pc/mobile 都不挂）。web_test_cases 表的 driver_path / close_browser_after_execution 列保留向后兼容,前端不再读写
- **2026-06-07**: Agent 集中推送架构（task #82 ~ #94）决策:（1）**只支持 Linux** —— systemd 是 Linux-only,塞进 macOS/Windows 等同于在 ssh push 里塞 3 套 if/else,先不发。（2）**server 不自动 SSH 重拉/升级** —— 显式按 UI 按钮触发,server 端 cron bug 不会拖垮用户机器。（3）**bundle 全量推**（~1.5GB tar.gz）,不打 diff,不打增量 —— 用户原话"反正内网快"。（4）**agent version mismatch → 401 → 自我 exit** —— agent 启动 + 每次心跳带 version,server 对比 `pkg.version` 不一致返 401 + `{required_version}`,agent 看到 exit(1) → systemd 标 failed → UI 出现 needs_upgrade=1 角标 → 用户点按钮重推。（5）**SSH 凭据 AES-256-GCM 加密**存 `devices.ssh_password` / `ssh_private_key` 列,key 来自 `AGENT_SSH_KEY_SECRET` env(32 字节 hex),列名做 AAD 防换列密文复用。**密文永不进 API response**,前端用 `has_*` 布尔占位。（6）**手动部署路径保留** —— 走 SSH push 是默认推荐,但 CI runner / 个人开发机 / 非 Linux 用户还能用 `npm run agent` 方式,文档明确标注为"开发/CI 备用"

## Key Learnings

### TS 5+ JSX ternary/&& with `unknown` (2026-06-02)
- `unknown && <X/>` or `unknown ? <X/> : null` produces a result typed as `unknown` because `unknown` widens to the top type — JSX children expect ReactNode, NOT unknown.
- Pattern: wrap each `unknown` value in `Boolean()` or use explicit null checks (`!= null`) before the `&&` chain.
- The error often reports on the parent `<div>` or opening `{` brace, not the specific bad line — search the whole JSX tree for raw `unknown` values used in `&&` or `?:` conditions.

### apiFetch<T> returns ApiResponse<T> not T (2026-06-02)
- `apiFetch<T>(url)` returns `Promise<{ code: number; message: string; data?: T }>`.
- The correct type parameter is the inner data type, NOT the wrapped envelope.
- WRONG: `apiFetch<{ data: TagInfo[] }>('/tags')` then `setTags(res.data)` — `res.data` is `{ data: TagInfo[] }` not `TagInfo[]`.
- CORRECT: `apiFetch<TagInfo[]>('/tags')` then `setTags(res.data)`.

### `Promise<X>` cast to non-Promise type fails (2026-06-02)
- `apiFetch<T>(url) as { code, data? }` errors with "Conversion of type Promise<X> to Y may be a mistake" because Promise is a wrapper, not the unwrapped value.
- CORRECT: just `await` it inside the Promise.all — the type flows through correctly.

### Midscene ReportGenerator 路径控制 (2026-06-03)
- `agent.reportFileName` 是 `getMidsceneRunSubDir('report')` 下的子目录名（不是完整路径），无法直接指定目标位置
- `outputFormat: 'html-and-external-assets'` 落盘布局：`{rootDir}/{reportFileName}/index.html`
- `agent.reportFile` 在 `writeOutActionDumps()` 中段就被赋值，但**最终路径在 `await agent.destroy()` 后才确定**（finalize()）
- 自定义落盘位置的最稳姿势：构造时设 `outputFormat: 'html-and-external-assets'` + 期望子目录名 → 调 `destroy()` → 读 `agent.reportFile` → 复制到目标路径
- `outputFormat: 'single-html'`（默认）会把整张报告塞到一个 HTML 文件里（含 base64 截图），移动端首屏加载慢

### PC schema drift (2026-06-03) — 隐性 bug 发现
- `pc_test_cases` 表实际只有 13 列（user_id, name, description, tags, status, steps, check_points, data_drive, preconditions, window_size, timeout, created_at, updated_at + created_by/updated_by）
- TypeScript `PcCaseRow` 接口和 `createPcCase()` 原本引用了 **不存在的列**：`browser` / `headless_mode` / `base_url`
- 一直没爆是因为 UI 也从未暴露这三个字段，所以 INSERT 路径走不到（不会写）；但一旦有人手写 SQL 或前端补一个 input 就会立即 SqliteError
- **Phase 3.5 修复**：`db/pc-cases.ts` 接口+INSERT 同步移除；`routes/pc-cases.ts` POST/PUT 不再传递；`engine/pc-executor.ts` 硬编码 `chromium`+`headless=true`+移除 baseUrl goto（原本就是 undefined 永远不执行）
- 教训：跨 web/pc/mobile 三端的 `*_test_cases` 表**列名一致性**是隐性契约，要靠 schema 文件或迁移文件做单一来源

### Mobile Phase 4 deviation (2026-06-03) — 保守路径
- 计划要求完整 NL-only 重写 + HarmonyAgent（@midscene/harmony）
- 实际只做了：1) `preconditions` 列迁移；2) `mobile_case_executions` 路由层写入；3) 文档化 deviation
- **不做**的理由：mobile 端要真机/模拟器才能验证，强行重写 + mock = 零验证 = 高回归风险
- 现在的 mobile-executor 仍然用 10-action switch（launch/tap/input/swipe/scroll/back/home/screenshot/assert/sleep），跑得通就别动
- 后续 Phase（待排期）：装 `@midscene/harmony` → 改 mobile-executor 用 `parseNLSteps(testCase.test_script, MOBILE_ASSERTS)` → 配真机 e2e

### Midscene 报告静态服务 (2026-06-03)
- `/midscene-reports` 必须 `express.static` 直接挂，**不要**加 `Content-Disposition: attachment`（那个是为下载场景；iframe 嵌报告必须 inline 显示）
- 保留 `X-Content-Type-Options: nosniff` 防 MIME sniff XSS
- 路径用 `path.join(dataDir, 'midscene-reports')` 而不是相对路径，免得工作目录变化
- 清理策略：mtime 超过 N 天的 exec_id 目录直接 `fs.rm({recursive: true})`；midscene-reports 本身可能不存在（ENOENT 是合法状态，return 空 stats）

### Phase 6 拆分边界 (2026-06-03)
- LogTab 这种**纯展示型 + props-only**的组件适合拆 (下游 state 在父组件里)
- StepsTab / CheckpointTab 这种**行内编辑型**组件不适合直接拆：state 太多（editingIndex、列表 CRUD、validation），强行拆出来 prop 列表爆炸
- 真要拆行内编辑，得先在父组件里把 state 提到顶层（`checkpoints` + `setCheckpoints` 已经是顶层了，但每个 cell 的临时编辑状态 `editingCheckIdx` 还在 useState 里——这个又得继续提）
- 结论：仅拆了 LogTab（共节省 ~100 行 + 共享复用）。其余 tab 留到下一轮专门的重构

### 7-phase refactor 总结 (2026-06-03)
- Phase 1-3: 标准化执行表 + web/pc NL-only + 修了一个 latent PC schema drift bug (bug-009)
- Phase 4: mobile 走保守路径 (deferred NL 重写 + Harmony)，保住了现有 mobile-executor 可用
- Phase 5: MidsceneReportViewer 组件 + /midscene-reports 静态路径 + 30 天清理 cron
- Phase 6: 只拆了 LogTab (纯展示)，其它 tab 因 state 耦合延后
- Phase 7: smoke 测试 20/20 覆盖 mobile migration + pc schema regression + cleanup
- **Phase 7 补完 (2026-06-03, 触发 bug-037)**: 用户质问前端未动 → 全量补救 nlStepToMobileAction 反向桥 + DELETE 迁移 + 3 个详情页 NL UI + 25/25 smoke test

### 隐性契约与回归守卫 (2026-06-03)
- TS 编译期的 @ts-expect-error 是最强的"禁止某些字段出现在接口中"的守卫
- 比 runtime 检查更早发现问题（IDE 改完保存就红线）
- 写测试时，**优先用类型系统做断言**（keyof、Exclude、Pick）而不是字符串比较

### NL 反向桥模式 (2026-06-03) — 重构期保 executor 稳定
- 数据形状升级（老 `{action, desc}` → 新 NL `{description, expect?}`）时，executor 通常不希望被重写
- 解决方案：在 executor 入口加一层"反向桥"函数，把 NL 拆回老格式
  - 例：`nlStepToMobileAction(step: NLStep): {action, target, value}` —— `expect` 非空 → `assert(target=expect)`；description 第一 token 匹配 MOBILE_ACTIONS → 拆 `{action, target}`；否则兜底 `tap(target=desc)`
- 收益：executor 内部 10-action switch 完全不动，只换数据来源；smoke test 只需补桥函数的 3-5 个断言
- 适用场景：任何"前端/存储已升级到新格式，但后端执行器还在跑老 switch"的过渡期
- 不要在桥里"聪明地"做语义推断（如把 `description: '点击登录'` 翻译成 `{action:'tap', target:'登录'}`），只做字面拆分 + 兜底

### DELETE 迁移 + FK CASCADE (2026-06-03) — 用户授权下的清空路径
- 场景：用户说"旧数据没用，直接清掉"，但 child 表（logs / executions）有 FK 引用
- 标准做法：1) 查 child 表的 CREATE TABLE 确认 `ON DELETE CASCADE`；2) 在 db/index.ts 末尾 `db.exec('DELETE FROM parent_table')`；3) 注释里写"用户授权，不做迁移"
- 不需要：`PRAGMA foreign_keys = OFF`、手动 DELETE child 表、临时禁用 FK
- 本项目 `web_case_logs` / `pc_case_logs` / `mobile_test_logs` / `*_case_executions` 6 张子表全部 CASCADE，父表 DELETE 一行就清完

## Key Learnings

- **Codex 桌面端 Debug Menu**: 隐藏入口,快捷键 `Alt+D` 直接弹出 Debug 弹窗,内含 "Plugins" 面板和 "Reload bundled plugins" 按钮(用于恢复 `@chrome` / `@browser` 等依赖 native pipe bridge 的插件);侧边栏 Debug 链接仅在 `dev` / `agent` build flavor 可见;production 构建只能走快捷键。Codex 版本:见 `/Applications/Codex.app/Contents/Info.plist`。
- **`@chrome` 桥接不可用时回退**: 当 Codex 桌面会话缺 `node_repl` MCP 工具时,`browser-client.mjs` 会报 `privileged native pipe bridge is not available; browser-client is not trusted`;对纯导航需求可回退到 `open -a "Google Chrome" <url>`(需要 sandbox escalate),效果与 `@chrome` 投递 URL 等价。
- **ssh2 回调 API 包成 Promise 的最小模板(2026-06-07)**: `new Client()` + `on('ready')/on('error')/on('close')` + `connect({host, port, username, password|privateKey, readyTimeout: 20000})`,`ready` 时 resolve `{ conn, end }`,`error` 或 `close`(未 settled)时 reject 并 `conn.end()`。conn 是 Client 实例可复用 `sftp()` 和 `exec()`。SFTP 上传:`conn.sftp((err, sftp) => sftp.createWriteStream(path).pipe(src) + close 回调 resolve)`,务必在源 stream 的 `error` 上 `src.unpipe()` 防 leak
- **AES-256-GCM 列名做 AAD(2026-06-07)**: 存"每行不同密钥但同列名"的密文时,用列名当 `additionalData` 防止 attacker 把 `ssh_password` 列的密文换到 `ssh_private_key` 列 —— GCM tag 校验会失败,解密时直接 throw。key 32 字节 hex 来自 env,`iv` 12 字节随机,`authTag` 16 字节。存:JSON.stringify `{iv, tag, ciphertext}`(三段都 base64)。解:parse → decipher.setAAD(colName) → decipher.setAuthTag → decipher.update + final
- **Promise.race 软超时(2026-06-07)**: 长跑操作(SSH push ~1-2min)不要在内部 setTimeout 写复杂取消逻辑,直接外层 `Promise.race([mainPromise, timeoutPromise])` 包一层。timeout 命中时只需 `console.error` + 收尾清理(`bundle.stream.destroy()` + `sshConn?.end()`),socket 残余让 OS GC。**不要在 timeout 里 try kill 子进程** —— 跟远端 systemctl 会有 race,反而留僵尸
- **idempotent 跨 systemd 写文件(2026-06-07)**: 部署时用 `if [ ! -f /etc/systemd/system/auto-test-agent.service ]; then cat > ... <<EOF ... EOF; fi` 包一层,避免覆盖用户在本机手工改过的 unit。env 文件用 `echo ... | sudo tee /etc/auto-test-agent.env` 幂等覆盖(这是配置不是用户手改的代码)。systemd unit 路径也用 `daemon-reload` + `enable` + `restart` 三连,缺一不可

## Do-Not-Repeat

- (2026-06-03) 不要在 Codex 桌面 session 中假定 `node_repl` MCP 工具存在 —— 在某些桌面会话里它不可用,导致 `@chrome` / `@browser` 自动化全挂。先用 `list_mcp_resources` 探活,再决定走 `@chrome` 还是 `open` 兜底。
- [2026-06-05] Playwright Browser 在 server 进程里应该做 singleton,每个 case 用 `browser.newContext()` 隔离 cookies/state。Browser 复用省 ~2-3s 冷启动;BrowserContext 必须 per-case new,否则 cookies/storage 跨 case 泄露。key = `${browserName}|${headless}|${driverPath}`:参数变化(用户切 headless 或换驱动)时必须先 close 旧 Browser 再 launch 新的,否则会泄露 Chromium 进程
- [2026-06-05] close_shared_browser 必须是 idempotent + concurrency-safe:用 `_sharedBrowserClosing: Promise<void> | null` 缓存正在进行的关闭,后续 await 同一个 promise。否则并发 case(用户连续点 2 个执行)会让 `browser.close()` 二次调用报 "Browser has been closed"
- [2026-06-05] 进程级 Browser singleton 配套需要 admin 端点(`GET /api/executor/shared-browsers` + `POST /api/executor/shared-browsers/close`),否则用户没法手动关掉调试用的 headless 浏览器。诊断信息(`launches`, `uptimeMs`)对排查"为什么我的浏览器没复用"至关重要
- [2026-06-05] SQLite schema 加列的标准流程:(1) 在 RESTORE_SCHEMAS 的 CREATE TABLE 加列,(2) 在启动 migration 块加 `try { ALTER TABLE x ADD COLUMN y ... } catch { /* exists */ }`,(3) db 模块的 Row interface + CreateInput + UpdateInput 都加字段,(4) route 模块解构 `req.body` + 转换逻辑,(5) client type + UI。少一步都会有 undefined / 列不存在 报错
- [2026-06-10] router.use(authMiddleware) 全局挂在 SSE /stream 路由会把所有 EventSource 连接也拦死,前端 401 → drawer 永远'启动中...':SSE 不能传 Authorization header,EventSource 只支持 cookies / query 参数。**修法**:用 `router.get(path, sseTokenQueryFallback, handler)` per-route 挂载,`sseTokenQueryFallback` 从 `?token=` 读 JWT、verifyToken、塞 req.user,跟 WebSocket 升级路径一致。**`/preview/stop` / `/preview/start` 这类有 fetch Authorization header 的端点可以保留 router.use,但同一个 router 下的 SSE 端点必须 per-route 挂**。**状态机**:EventSource 失败时 `readyState === CLOSED` 要分两种情况 — (a) 启动时就 CLOSED = 401/404/设备离线,直接切 error;(b) streaming 中 CLOSED = 网络抖动,切 lastError 但保留 streaming。两种都设置会让 UI 卡在'启动中'或错误地显示"已断开"
- [2026-06-05] Playwright 1.60 + Chromium 130+ 的 new headless 模式在 macOS 上 `page.screenshot()` 返回空 buffer(报告里截图全是 SVG 占位,base64 length=0),**不是** macOS 屏幕录制/辅助功能权限问题(headless 进程根本不会触发这些权限弹窗)。根因:new headless 默认没启用 SwiftShader 软件 GL 渲染。修法:launch options 加 `args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']`。web-executor 和 pc-executor 的 launchBrowser 都要加。备选:`--headless=old` 切回旧 headless(兼容性最好,但 Chromium 已标 deprecated)
- [2026-06-11] scrcpy 预览 caseExecutionId 变化会断开 WebSocket:usePreviewSession 的 useEffect deps 包含 caseExecutionId,当 /execute 返回 execution_id(null→number)时触发 cleanup+reconnect,scrcpy 被撕开再重建。**修法**:从 deps 中移除 caseExecutionId。预览 session 生命周期只依赖 enabled/deviceId/serial/kind,caseExecutionId 是 advisory(server 用于关联审计),不影响流
- [2026-06-11] 先连屏再执行(串行化):移动端执行"屏幕没连上但动作已开始"的根因是 handleDeviceSelected 同时发 preview start + /execute,scrcpy 首次连接需要 2-5s(推 server binary+启动+等视频流),但 /execute 返回立即开始跑步骤。**修法**:两阶段 — (1) open drawer + pendingExecute=true,等 state==='streaming';(2) useEffect 监听 streaming + pendingExecute 才发 /execute。用户看到"正在连接屏幕，连接成功后自动开始执行..."
- [2026-06-11] overlay→并排布局重构模式:把 Drawer(overlay)改成 Panel(inline flex)时,关键步骤是把 Drawer 内部的 hooks(usePreviewSession+useScrcpyDecoder)和 state(frameCount/scrcpyStatus/scrcpyMetadata)上移到父组件,Panel 只做纯渲染(所有数据通过 props 传入)。父组件用 `.mtd-content-row { display: flex }` 包裹 body+panel,panel 用条件渲染 `{preview.open && <div className="mtd-preview-panel">...</div>}`。Drawer 文件保留不删,只是不再引用
- [2026-06-11] 移动端断言从结构化字段改为自然语言:原 AssertionRule(source/key/operator/expected)改 TextAssertion({type:'text',text:string}),后端用 agent.aiAssert(text) 执行。前端 textarea 多行输入,每行一条断言。JSON 数组存 mobile_test_cases.assertions 列,向后兼容 — 读取时检测旧格式自动转 TextAssertion
- [2026-06-11] 设置页改为 Drawer:全页路由 /settings/* 改为 SysHeader 内触发的右侧 Drawer。关键:Drawer 用 `position: fixed; top: var(--header-h); left: var(--sidebar-w); right: 0; bottom: 0` 只覆盖 body 区域,不挡侧边栏和 header。SysHeader 管理 settingsOpen state,下拉菜单"账号与设置"触发。5 个子页面直接 import 渲染(不用路由),activePage state 切换。App.tsx 删除 SettingsLayout 嵌套路由,/settings/* redirect 到 /

## Decision Log

- [2026-06-06 #78] 共享 ScheduleList 跨 4 个测试类型复用方案：basePath 派生 testType → endpointFor 出 `/schedule-sets-{type}`；列表项 fetchList 阶段直接打 `testType + setId/setName/setCount` 戳（统一显示字段）,代码里再无 `item.testType === 'api' ? a : b` 散落。stamped fields 选 optional 标在主 interface 上避免每处 cast。
- [2026-06-06 #79] 跨受控 state 双向同步陷阱:同组件内有 N+1 个 useState 互相派生时,**别在事件处理里直接用其它 setState 之后的 state 值**(setState 异步,buildCron 读的是旧值);让 useEffect 接管派生方向,再用 useRef 标记 "skip sync" 防止反向同步时形成回环。常见配对:5 个 select 字段 ↔ 1 个合成字符串(本例 cronExpr);商品 SKU 多维 ↔ 标签云;表单多选 ↔ JSON 序列化。

## Decision Log

- [2026-06-06 #80] PC 自动化方向:确认走 `@midscene/computer` (ComputerAgent) 而不是继续用 web PlaywrightAgent stub。理由:PlaywrightAgent 只能在 headless Chromium 里跑,无法测真桌面 app;ComputerAgent 用 libnut + screenshot-desktop 跨平台原生输入,能测任何桌面 app,实时预览用 scrcpy over RDP,支持远程 PC。触发时机:用户下次调试 PC 测试时,先装包 → 改 agent 入口 → 新建 pc_computer_config 表 → 跑通 demo case(~1 周)。
- [2026-06-08 #101] 设备库 / 模型配置 / 浏览器配置 移到独立 `/settings` 路由:这 3 个是 per-user 资源(每个 user 一份 midscene_config / devices / web_browser_config 行),之前误放在 4 个测试类型侧边栏里,用户从任意测试类型进来都能看到 → 跟"测试类型资源"概念混淆。**正解**:`src/client/components/SettingsLayout.tsx` 独立的用户中心布局(账号 / 我的资源 两段),`src/client/components/SysHeader.tsx` 抽出来作为 Layout + SettingsLayout 共享的顶部条(返回主页 + 环境切换 + 用户菜单 → "账号与设置" / 退出登录)。`App.tsx` 旧路径 11 条全部 `<Navigate replace>` 兜底(`/profile` `/change-password` + 4 个测试类型 × `devices` / `midscene-config` / `web-test/browser-config`),保证老链接 / 邮件模板 / 收藏夹不失效。SysHeader 类型坑:`useEnvironment().environments` 是 `Environment[]`,Dropdown 的 `env.map((env: {id, name}))` 窄类型会被 `setActiveEnv(env)` 拒(期望 `Environment`),要用 `import type { Environment }` + `env: Environment`。SVG 重复属性坑:Layout.tsx 既有 monitor 图标 `<rect width="20" width="14">` 是 typo,改成 `height="14"`。**模式**:Layout 共享头部 → 抽 SysHeader(子组件,父不感知差异);多路径搬迁 → `<Navigate replace>` 在 ProtectedRoute 下挂兜底,不要让旧链接变 404
- **Midscene 设备枚举 API 不全(2026-06-08)**: `@midscene/android` 的 `getConnectedDevicesWithDetails()` 只返回 brand/model/resolution/density,**不**包含 os_version / sdk_int;`@midscene/harmony` 的 `getConnectedDevices()` 只返回 deviceId。需要在 merge.ts 里并行 `adb -s SERIAL shell getprop ro.build.version.release / sdk` 和 `hdc -t SERIAL shell getprop ro.product.brand / model / os.build.version.release / wm size` 自己补。Android SDK 字段对 Harmony 不适用(API level 概念不一样),Harmony 留 null
- **Midscene agent 工厂的 deviceId 位置参/选项对象差异(2026-06-08)**: `agentFromAdbDevice(deviceId?, opts?)` 和 `agentFromHdcDevice(deviceId?, opts?)` 的 deviceId 是**位置参数**(string),`agentFromWebDriverAgent(opts?)` 根本没 deviceId(WDA 是单设备进程,多 iOS 设备需起多个 WDA)。`mobile-executor.ts` 早期错写成 `{ deviceId: '...' }` 选项对象形式,tsc 报 `string` not assignable
- **Express `Map` 异质 value 必须显式类型(2026-06-08)**: `new Map<string, { local?: X; remote?: Y }>()` 然后 `map.get(k) || {}` 的展开结果被推断为 `{ [k: string]: any }`(或 `string | number`),赋回原类型会报错。修法:`const prev: { local?: X; remote?: Y } = bySerial.get(k) || {}; bySerial.set(k, { ...prev, local: it })` — 显式声明 prev 类型,TS 不再 widen
- **DeviceStatus 三态 → MergedDevice 二态收窄(2026-06-08)**: DB `DeviceStatus` = `'online' | 'offline' | 'unknown'`,但 `MergedDevice.status` 给前端只有 `'online' | 'offline'` 两态(简化 UI)。收窄:`row.status === 'online' ? 'online' : 'offline'`,把 `unknown` 当作 `offline`(用户感上等价"看不到状态")
- **远端 adb/hdc/WDA 通过 SSH LocalForward 透明化(2026-06-09)**: server 端"以为"本地端口实际是远端服务。ssh2 提供 `Client.forwardOut(srcIP, srcPort, dstIP, dstPort, cb)` 返回一个 ClientChannel,`net.createServer` 监听 127.0.0.1:RANDOM_PORT,每条新连接用 `forwardOut` 拿 channel 后 `sock.pipe(channel); channel.pipe(sock)` 双向 pipe。**Midscene 工厂函数零修改**: Android/Harmony 走 `process.env.ADB_SERVER_SOCKET=tcp:127.0.0.1:PORT`(adb client 启动读这个 env 决定连哪个 adb-server)/ `process.env.HDC_SERVER_PORT=PORT`(hdc 同样语义);iOS 走 `agentFromWebDriverAgent({wdaHost: '127.0.0.1', wdaPort: tunnelPort})` 显式 host/port
- **adb 5037 vs hdc 5037 端口语义(2026-06-09)**: adb-server 默认 5037;hdc-server **也**默认 5037(Linux/Mac 上都是)。两者隧道都用 `remotePort: 5037`,在远端一台机器上共存的可能性 — 实际不会撞,因为同一台远端通常只跑一种 device(Android 不会有 hdc,Harmony 不会有 adb)。如果未来同台远端 Android+Harmony 都有,要按设备行的 metadata 分别路由
- **TypeScript discriminated union narrowing 跨 `await` 会失效(2026-06-09)**: `{ kind: 'new', creds } | { kind: 'existing', conn }` 这种 union,如果先 `const conn = provider.kind === 'existing' ? provider.conn : null` 再 `if (!conn) { await connectSsh(provider.creds) }`,TypeScript 在 else 分支里认为 `provider` 还可能是 `'existing'`,报 `Property 'creds' does not exist`。修法:直接 `if (provider.kind === 'existing') { ... } else { await connectSsh(provider.creds) }`,在 if 表达式里用 kind 而不是派生 boolean
- **tunnel 生命周期 ≠ agent 生命周期(2026-06-09)**: 一个 case 跑下来会 1) 起 SSH 连接 2) openSshTunnel 拿 ActiveTunnel 3) agent factory 4) 跑 case 5) agent.destroy()。**tunnel.close() 必须在 finally 里独立调**,跟 agent.destroy() 平级,否则每跑一个远端设备用例就留一个 LISTEN socket,几小时后 `EADDRINUSE`
- **React 18 `useRef<T>(null)` 实际类型是 `RefObject<T>` 不是 `RefObject<T | null>`(2026-06-10)**: TypeScript 在 React 18 把 `useRef<T>(null)` 的返回类型从老的 `RefObject<T | null>` 收窄成 `MutableRefObject<T | null>` / `RefObject<T>`(取决于 overload)。**当把 ref 传给子组件的 prop 时**,子组件的 prop 类型必须匹配 hook 的实际返回类型,写 `RefObject<HTMLCanvasElement>` (不带 | null),否则 `Type ... is not assignable to type 'RefObject<HTMLCanvasElement | null>'` 的 TS2322。**诊断**: 报错时看下 hook 调用点用的是 `useRef<T>(null)` 还是 `useRef<T | null>(null)`,两者返回类型微妙不同,跨组件传 ref 必须用同一个 flavor
- **`WebCodecsVideoDecoder.writable` 是 unknown 包裹的 WritableStream(2026-06-10)**: `@yume-chan/scrcpy-decoder-webcodecs` 的 `decoder.writable` 在 TS 类型里是 unknown(他们用鸭子类型,不暴露内部 WritableStream)。**修法**:`(decoder.writable as unknown as WritableStream<{type:string, data:Uint8Array}>).getWriter()`,拿 writer 后类型变 `WritableStreamDefaultWriter<{type,data}>`。不要试图用 `decoder.writable.getWriter()` 直接拿,TS 会拒
- **`writer.closed` 在 TS 推断里永远是 false(2026-06-10)**: `writer.write()` 永远返回 Promise,TS 推断 `writer.closed` 不会因 write 调过而变 true (虽然运行时它会),任何 `if (writer.closed) return` 都会被 TS 报 TS2801 "Condition always false"。**修法**:去掉这个 check,直接 `void writer.write(packet).catch(log)`,错误处理走 .catch 链。**反模式**: 不要写 `if (!writer.closed) writer.write(...)` — 跟原来一样被 TS 拒
- **scrcpy 1 字节 type prefix 协议增强(2026-06-10)**: 标准 scrcpy 协议是直接吐 ScrcpyMediaStreamPacket(自动带 type discriminator),但 server → client WebSocket binary 走 JSON 之外,接收方需要明确区分 configuration(SPS/PPS,只在首条) 和 data(H.264 NAL unit)。**在 frame 第一个字节加 type prefix**:0x00 = configuration,0x01 = data。**好处**:客户端 `push(bytes)` 第一行就 `if (view[0] === 0x00) ... else ...`,不用维护 "是否已收到首条" 状态。**对比 agent-mobile/scrcpy.ts**: 那条路径是 server 在内部 pipeline 里消费,不需要 wire 协议,无 prefix;只有 local-scrcpy → client WebSocket 这条边界加了 prefix
- **drawer 提前开 UX 优化(2026-06-10)**: 移动端执行预览抽屉不要等 `POST /execute` 返回 caseExecutionId 才 setOpen(true)。**正解**:handleDeviceSelected 立即 `setOpenPreview(true) + setPreviewKind('scrcpy')` 再 `await /execute`,caseExecutionId 拿到后用 `setPreviewSessionId` 二次更新。这样用户点击执行 → 抽屉立即滑出 → 流开始推 → server 慢慢排队执行。**测量**: Android 设备点执行到 first frame 的延迟从"等 /execute 几百毫秒 + adb 启动 + scrcpy 协商"压缩到"打开 drawer 16ms + scrcpy 协商"。**不破坏语义**:drawer 自己有 `enabled: open` 控制 session lifecycle,caseExecutionId 是 advisory 字段(server 用于审计),不强依赖
- **scrcpy `framesRendered` / `framesSkipped` 只能 polling(2026-06-10)**: `WebCodecsVideoDecoder` 内部用 rAF loop 渲染,这两个数字在内部累加,只暴露属性不暴露 callback。**修法**:`useEffect` 里 `setInterval(() => setRenderedFrames(d.framesRendered); setDroppedFrames(d.framesSkipped), 500)`,500ms 节流防止 React 渲染压力,UI 显示"渲染 X 丢帧 Y"。**为什么 500ms 不是 100ms**: rAF 是 60FPS,1s 60 帧,100ms polling 会让 React 6 次/秒重渲染 stats 浮层,500ms 是 2 次/秒,体感实时但 CPU 友好

### Device-keyed shared scrcpy + 60s idle timer (2026-06-10)
- **Map key 必须从 sessionId(per-subscriber)改成 deviceKey(per-device)**: 共享模型的本质是"一台设备 = 一个 scrcpy client",不是"一个 viewer = 一个 client"。`deviceKey = '${kind}:${serial}'`(`android:emulator-5554`)。原代码用 UUID 同步 Map → 每个 viewer 拉一个 scrcpy 进程,资源浪费严重
- **reader 必须共享,不能 cancel**: `client.videoStream.stream.getReader()` 只能 getReader 一次,存在 session 字段上。fan-out 逻辑:reader loop 内 `for sub of subscribers.values() { sub.ws.send(payload) }`。**关键不变量**:subscriber 关闭时**只** set `sub.closed = true`,**绝不** cancel 共享 reader — 取消 reader 会让所有 viewer 一起断。只有 `forceClose` 才能 cancel
- **idle timer 用 unref() 不阻塞进程退出**: `setTimeout(..., 60_000).unref()` — 进程退出时 timer 不会 hold 进程。`subscribers.size === 0` 时启动 timer,attach 时 cancel。`lastIdleAt = Date.now()` 记录"viewer 归零时刻",merge.ts 用它算 `previewReleasingAt = lastIdleAt + 60_000` 给前端倒计时
- **30min 硬 GC 互补 60s 软回收**: 60s 软回收依赖 `subscribers.size===0` 判断,但若 reader loop 因故卡死(底库 bug),60s timer 永远不来。**30min 硬 GC** 扫 `deviceMap` 中 `Date.now() - startedAt > 30min` 的 session 强杀。两个都保留,软回收正常路径走、硬 GC 兜底异常

### 设备级执行 busy 锁 — string mutex key 模式 (2026-06-10)
- **mutex key 必须是 string,不是 number**: 远端设备 id 是 number,本地设备 id 是 string(`local:android:<serial>`)。同一个 mutex Map 要兼容两种,key 统一为 string:远端 `remote:<id>`,本地 `<deviceId 原样>`。SQL busy check 只对远端可走(本地无 devices.id 行,`mobile_case_executions.device_id` 是 NULL)
- **mutex 主导单进程,partial UNIQUE INDEX 兜底多进程**: 单进程用 `Map<lockKey, Promise>` + `.catch(() => undefined).then(fn)` 链式防 reject 毒化。`UNIQUE INDEX ... WHERE status='running' AND device_id IS NOT NULL` 跨进程/未来多 server 场景兜底,UNIQUE constraint 错误 catch 返 409。**两层**:mutex 99% 路径走,UNIQUE 1% 异常路径
- **execute start/finish 必须 invalidateAllMergedCache**: 设备 busy 状态变了,其他用户开 modal 应该立刻看到(不阻塞到 30s TTL 过期)。N 个用户 × 30s cache,全清后最多引起 N 次重算(单次 ~200-500ms),低频操作可接受。**模式**:执行入口两端都调 `invalidateAllMergedCache()`,既清自己用户的也清所有用户的

### Mutex 类型签名变更必须同步所有调用点 (2026-06-10)
- 把 `Map<number, Promise>` 改成 `Map<string, Promise>` + `withDeviceLock(lockKey: string, fn)` 后,**所有调用点**都要改用 string 构造锁 key。**修法**:在 route handler 入口根据 `req.query.deviceId` 类型(本地 string 走原值,远端 number 走 `remote:<id>`)派生 `lockKey` + `execDeviceId`(number|null),再传给 mutex。SQL check 仅在 `execDeviceId !== null` 时跑,本地走 mutex 单层防护
- [2026-06-18] CSS 不允许在 App.css 和 components/*.css 两个地方同时定义 sys-shell layout 选择器(.sys-shell / .sys-sidebar / .sys-brand / .sys-nav / .sys-main / .sys-header / .sys-content)。历史事故:App.css 和 Layout.css 重复定义且 .sys-content padding 不一致(24px vs 0),导致 CSS 加载顺序变化时主内容区与 header/sidebar 之间的缝隙时有时无,theme 切换后视觉表现漂移。修复:删除 App.css 里所有 sys-*/hdr-* 规则,Layout.css 成为唯一来源。在 App.css 删除处加了注释明确禁止未来再重复定义。用户原话:"css和页面布局要统一抽取出来"。
- [2026-06-18] 主内容区(.sys-content)padding 必须为 0,让页面容器(如 .alist, .dashboard-home)直接紧贴 header 底边和 sidebar 右边,不要任何灰色缝隙。各页面内部容器自己负责内边距(.alist-filter padding:16px, .dashboard-home padding:20px)。用户原话:"主内容区域应该和上面的header区域和左侧的菜单栏区域挨着,不要有缝隙,可以用直角"。
- [2026-06-18] 未定义的 CSS 变量不要用 fallback 写死颜色值,改为引用语义相近的已定义变量。例:.sys-nav-item-hint 之前用 var(--fg-muted, #9ca3af),--fg-muted 从未在 :root 或 [data-theme="dark"] 定义,fallback 在 dark theme 下也是亮灰色,与 dark 主题冲突。改为 var(--fg-tertiary) 后 light/dark 都正确。
- [2026-06-18] CSS 中所有元素背景必须用 var(--surface) 等主题变量,禁止硬编码 `background: #fff` / `background: white` / `background: var(--surface, #ffffff)`(带 fallback 也是绕过主题)。否则 dark theme 下元素仍是白色,与深色主体冲突看不清。**例外(保留白字/白底)**:1) 按钮文字色 `color: #fff`(在 accent/danger/success 彩色背景上);2) toggle 开关的圆球(rule-switch-slider::before / .ad-rule-switch 圆球,在彩色滑轨背景上需要白球可见);3) tooltip 类深底+白字设计(如 .var-tooltip 用 #1e1b4b + #fff);4) brand-dot/logo 等纯装饰元素。
- [2026-06-18] .sys-content / .sys-sidebar / .sys-header 都不应有 border-radius。布局主体保持直角,让 header / sidebar / content 三块无缝紧贴。圆角只用在内部小元素(nav-item, brand-dot, avatar, button)作为视觉装饰。
- [2026-06-18] 第三方编辑器(CodeMirror/Monaco 等)在 dark theme 下必须显式注入 dark theme extension,不能依赖 CSS 变量。@uiw/react-codemirror 默认 light 主题,dark 主题切换不会自动跟随 document data-theme。解决方案:封装 ThemedCodeMirror 包装组件 + useThemeMode hook(useSyncExternalStore + MutationObserver 监听 [data-theme] 属性)。详情页 5 个直接调用 CodeMirror 的位置全部改用 ThemedCodeMirror。**禁止**在业务组件里直接 import @uiw/react-codemirror,必须用 ThemedCodeMirror。
- [2026-06-18] inline style 里禁止硬编码颜色值(#bbb/#999/#fff/#1677ff 等),必须用 `style={{ color: 'var(--fg-tertiary)' }}` 字符串形式引用 CSS 变量。React inline style 接受 CSS 字符串作为属性值,浏览器会解析 var() 引用。例外:状态色 success/danger 也要用 var(--success)/var(--danger) 而不是写死 #10b981/#ff4d4f。
