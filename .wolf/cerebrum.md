# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-05-17

## User Preferences

- **四种测试类型后端必须完全隔离**：API/Web/移动端/PC测试的数据必须通过独立表和独立路由管理，不共用表、不共用路由。test_type 字段不能作为隔离手段，只能作为辅助字段。原型设计与此冲突时，以本原则为准。
- **前端组件通过 API_PATH_MAP 调用隔离后端**：共享组件（ScenarioList, ScenarioDetail, ScenarioSetList, ScenarioSetDetail）使用 API_PATH_MAP 常量，根据 testType 调用对应的 /scenarios、/scenarios-web、/scenarios-pc、/scenarios-mobile 等端点。路由跳转也通过 ROUTE_PATH_MAP 常量映射。

## Key Learnings

- **Project:** auto-test-platform
- **Description:** 自动化测试平台 - 支持接口/Web/移动端/PC端自动化测试
- **basePath prop pattern**: 共享列表页组件（ScenarioList, MockList 等）通过可选 `basePath` prop（默认 `/api-test`）实现路由复用，不同测试类型传入不同 basePath
- **API_PATH_MAP 前端隔离模式**: 共享组件前端用 API_PATH_MAP/ROUTE_PATH_MAP 常量根据 testType 映射到对应后端 API 和前端路由，避免硬编码
- **MENUS_BY_TYPE 动态侧边栏**: Layout.tsx 通过 `location.pathname` 前缀判断当前测试类型，动态选择对应的菜单列表
- **移动端执行器抽象**: Android 用 ADB (keyevent, input tap/text/swipe)，iOS 用 WDA HTTP API (/wda/tap, /wda/keys, /wda/homescreen)，通过 platform 字段分发
- **Midscene 参考架构**: AndroidDevice extends AbstractInterface (ADB+appium-adb), IOSDevice extends AbstractInterface (WebDriverAgent)，共享通用操作，平台特有操作各自实现
- **展开行表格嵌套列宽对齐**: 场景集执行记录展开行用父表格结构直接延伸 `<tr>` 而非嵌套 `<table>`，列宽自然继承父表；空列用 `visibility: hidden` 保持宽度；子行用 `td:first-child { border-left: 3px solid var(--primary) }` 区分父子层级

## Do-Not-Repeat

- [2026-05-26] Agent tool API Error 400: 不要用 Agent 子代理探索文件，直接 Read/Grep 更可靠
- [2026-05-26] WebFetch 对 github.com 失败: 克隆 GitHub 仓库用 `git clone --depth 1` 而非 WebFetch
- [2026-05-27] PC/Web 共用 web-cases 表和路由导致命名混乱: PC测试应独立表 + /pc-cases 路由，Web测试用 /web-cases

## Decision Log

- **2026-05-26**: 移动端测试模块采用 stub 执行器，先实现接口和分发框架，后续再对接真实 Appium/Midscene
- **2026-05-26**: 共享页面（场景、定时、报告、Mock、环境）通过 basePath prop 复用，而非为移动端创建独立副本
- **2026-05-27**: 四种测试类型后端完全隔离原则：API测试用 apis 表 + /apis，Web测试用 web_test_cases 表 + /web-cases，PC测试用 pc_test_cases 表 + /pc-cases，移动端用 mobile_test_cases 表 + /mobile-tests。前端共享组件通过 testType prop + test_type 查询参数区分数据。
- **2026-05-28**: 前端共享组件隔离模式升级：场景/场景集等前端组件不再依赖 test_type 查询参数，改用 API_PATH_MAP 常量直接映射到隔离端点（/scenarios, /scenarios-web, /scenarios-pc, /scenarios-mobile），避免后端再按 test_type 过滤
- **2026-05-31**: 调度器重构：node-cron 替代 30 秒轮询，场景集粒度调度（schedule_sets 表），启动时加载所有 active 任务创建 cron job，pause/resume/remove/upsert/configure 接口同步调用 scheduler 方法
