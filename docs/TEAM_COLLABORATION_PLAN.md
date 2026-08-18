# 团队协作功能 · 实施计划（持久化任务清单）

> **用途**：本文件是团队协作功能的唯一任务清单与断点恢复锚点。每完成一个任务**立即**把 `⬜` 改为 `✅` 并更新「进度快照」。会话中断后新会话从「进度快照」继续，不要凭记忆重建计划。
>
> **状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ✅ 完成 ｜ ⏸ 阻塞/暂缓（注明原因）

---

## 进度快照（中断恢复点 — 每次任务状态变化后更新）

| 项 | 值 |
| --- | --- |
| 更新时间 | 2026-07-02 25:10 |
| 当前阶段 | **全部完成，TiDB 真库验证通过（14/14）** |
| 活跃任务 | 无 |
| 下一步 | ① 浏览器 UI 走查（npm run dev → 连接团队 http://localhost:3000 → 建团队/项目 → 导入本机资源）② 反馈问题修复 ③ Phase 5（中心执行器/部署文档）按需启动 |
| 阻塞项 | 无（TiDB 固定 127.0.0.1:4000，.env 已配 DB_URL） |
| 验收状态 | server/client tsc 双 0 错 + vite build ✓ + team-smoke 8/8 + **TiDB 真库全链路 14/14**（建库迁移/注册登录/团队项目/CRUD/乐观锁 409/版本快照/回滚/审计/权限隔离） |

---

## 全局技术约定（所有 Phase 遵守）

- **数据库**：团队数据存远程 TiDB（MySQL 协议），ORM 用 **Drizzle**。`DB_URL` 未配置时团队功能整体禁用，本地模式不受影响。启动时自动 `CREATE DATABASE IF NOT EXISTS` + 跑迁移。
- **架构核心：teamResourceDispatcher（routes/team-resources.ts）**——挂在所有本地业务路由**之前**。请求带有效团队 JWT + X-Team-Id/X-Project-Id 头时，业务 CRUD 直接由中心库服务（apis/web-cases/scenarios/devices/...18 种资源），否则穿透到本地 SQLite 路由。**现有前端业务页面零改动**。
- **列名约定**：团队业务表列属性全 snake_case 与本地 SQLite 列名一致（Drizzle 返回行形状 = 本地行形状）。团队新增列：team_id/project_id/owner_id/version。
- **乐观锁**：进程内 LRU 记录 GET /:id 时行版本，PUT 时版本不匹配 → 409 + 当前行；PUT body 带 version 也强制校验。409 时 apiFetch 广播 `team-conflict` 事件 → 全局横幅。
- **时间**：应用层 `nowSql()` 生成 `YYYY-MM-DD HH:MM:SS` 字符串，varchar(32) 列。
- **双 token**：本地 `token` vs 中心 `teamAuth:<centerUrl>`；LOCAL_ONLY_PREFIXES（/auth、/midscene-config、/web-browser-config、/user-preferences、/export-package）永远走本地。
- **角色**：owner > admin > editor > viewer（team 级，project 继承）；viewer 可执行不可改（写操作 403）。
- **执行类端点**（execute/preview/push/refresh）团队模式返回 501 + 清晰提示（中心执行器是后续 Phase）；logs/executions 返回空数组；dashboard 返回零值。
- **响应格式**：`{ code, message, data }` 与本地一致。

---

## Phase 0 · Drizzle 地基 ✅

- [x] 0.1-0.9 依赖/drizzle.config/client/migrate(含 ensureDatabase 自动建库)/util/schema(org+versions)/package scripts ✅
- [ ] 0.10 真库验证 ⏸ 等 TiDB（`npm run team:verify-db` 一键跑）

## Phase 1 · 中心服务核心 ✅

- [x] 1.1-1.16 全部完成（team-jwt / repo auth+org / team-auth+team-org 路由 / 前端 Workspace 全套 / SysHeader+App 接入 / tsc+build+smoke）✅

## Phase 2 · 团队业务资源 ✅（代码完成，待真库验证）

- [x] 2.1 schema/business.ts —— **列属性 snake_case 对齐本地行形状**（t_apis/t_scenarios(+nodes/edges)/t_scenario_sets/t_web_cases/t_pc_cases/t_mobile_cases/t_case_sets_{web,pc,mobile}/t_environments/t_devices/t_mocks_{api,web,pc,mobile}/t_schedule_sets_*/t_tags/t_audit_logs/t_notify_channels）✅
- [x] 2.2 迁移 0001+0002 生成（drizzle/*.sql）✅
- [x] 2.3 teamResourceDispatcher —— 18 种资源通用 CRUD：分页/筛选(LIKE+EQ+tag+date+keyword)/排序/create(审计+快照+通知)/detail(场景带 nodes+edges)/update(乐观锁 409+快照+审计+通知)/delete(级联 nodes+edges)/flow 保存/rollback ✅
- [x] 2.4 特殊端点：environments/default、devices/merged（仅 agent 在线设备）、tags CRUD（形状兼容本地）、dashboard 团队零值、batch-reports 空列表、execute→501/logs→[] ✅
- [x] 2.5 前端 api.ts：resolveTarget(path) 加 X-Team-Id/X-Project-Id 头 + LOCAL_ONLY_PREFIXES + apiFetchLocal + 409 冲突事件广播 ✅
- [x] 2.6 TeamConflictBanner 全局横幅（加载最新/稍后）✅
- [x] 2.7 resource_versions 快照/历史/回滚（content_hash 去重；回滚=旧快照建新版本，绝不改历史）✅
- [x] 2.8 presence 15s 心跳 + TeamResourceFab（右下角浮钮：在线成员/版本历史/一键回滚，路由感知零页面接线）✅
- [x] 2.9 团队设备池（dispatcher devices CRUD + merged 过滤 agent 可用设备；busy_slot 生成列方案未用——dispatcher 无 running 写入，暂不需要）✅

## Phase 3 · 导入导出（.atpkg）✅（代码完成，待真库验证）

- [x] 3.1 包格式（JSON：format/version/exportedAt/source/resources{type:[{id,name,row,depOf}]}）✅
- [x] 3.2 本地导出 routes/export-package.ts：/preview 资源树 + /build 依赖闭包（scenario_sets→scenarios→apis 深扫 node config JSON；case_sets→cases）+ 环境敏感变量脱敏（默认，可选包含）+ depOf 标注依赖来源 ✅
- [x] 3.3 中心导入 team-extras.ts /import/preview（名称粗筛+content_hash 精判 same/conflict/create）+ /import/commit ✅
- [x] 3.4 ID 重映射引擎：拓扑序导入（environments→cases→scenarios→sets）+ remapIdList（scenario_ids/test_case_ids）+ remapConfigRefs（node config 深度遍历 apiId/caseId 改写）+ 场景 nodes/edges 复制 ✅
- [x] 3.5 冲突策略：skip（保留团队版）/ overwrite（先备份团队版进版本历史再覆盖）/ copy（重命名副本「原名（导入副本 MM-DD HH:mm）」）✅
- [x] 3.6 导入完成写审计 + 每资源版本快照（origin=imported from local@account）+ webhook 通知 ✅
- [x] 3.7 前端 ImportToTeamModal 三步向导（勾选树→冲突预览/策略→摘要）+ .atpkg 下载 ✅

## Phase 4 · 感知与治理 ✅（代码完成，待真库验证）

- [x] 4.1 notify_channels CRUD + 飞书/钉钉(签名)/企微/Slack webhook 推送（资源 create/update/delete/import 事件，fire-and-forget）✅
- [x] 4.2 TeamManageModal：成员管理（添加/改角色/移除，owner 保护）+ 通知渠道管理 + 审计日志查询 ✅
- [x] 4.3 审计写入覆盖全部写路径（dispatcher CRUD/flow/rollback/import）✅
- [x] 4.4 teamStats 统计端点（/team/teams/:id/stats）✅

## Phase 5 · 规模化与部署 ⬜

- [ ] 5.1 中心服务部署脚本/文档（env 清单：DB_URL/TEAM_JWT_SECRET/CORS_ORIGINS）⏸ TiDB 验证后做
- [ ] 5.2 TiDB 真机回归（`npm run team:verify-db`）⏸ 等用户装
- [ ] 5.3 中心执行器（团队模式 /execute 真执行，调度设备池 Agent）⏸ 后续大项
- [ ] 5.4 调度 leader 锁（多实例）/ 报告对象存储 ⏸ 按需

---

## 变更记录

| 时间 | 变更 |
| --- | --- |
| 2026-07-02 21:55 | 计划创建；Phase 0 全部完成 |
| 2026-07-02 22:45 | Phase 1 完成（修全部幽灵依赖） |
| 2026-07-02 23:00 | client tsc 0 错；等 midscene 构建 |
| 2026-07-02 24:30 | **Phase 2/3/4 代码全部完成**：business schema（snake_case 对齐本地形状）+ teamResourceDispatcher（18 资源通用 CRUD+乐观锁+版本+审计+通知）+ team-extras（presence/审计/通知渠道/导入引擎）+ export-package（依赖闭包+脱敏）+ 前端（ConflictBanner/ResourceFab/ManageModal/ImportToTeamModal）+ team-smoke 8/8 + 完整启动冒烟 ✓。tsc 双 0 错 + vite build ✓。新增 scripts/team-verify-db.sh（TiDB 装好后一键验证） |
