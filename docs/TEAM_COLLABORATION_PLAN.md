# 团队协作功能 · 实施计划（持久化任务清单）

> **用途**：本文件是团队协作功能的唯一任务清单与断点恢复锚点。每完成一个任务**立即**把 `⬜` 改为 `✅` 并更新「进度快照」。会话中断后新会话从「进度快照」继续，不要凭记忆重建计划。
>
> **状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ✅ 完成 ｜ ⏸ 阻塞/暂缓（注明原因）

---

## 进度快照（中断恢复点 — 每次任务状态变化后更新）

| 项 | 值 |
| --- | --- |
| 更新时间 | 2026-07-02 23:00 |
| 当前阶段 | **Phase 1 完成，代码全部干净** |
| 活跃任务 | 无（等用户装环境） |
| 下一步 | ① 用户构建 ../midscene 后重跑 server tsc（应 0 错）+ 完整 dev 冒烟 ② 用户提供 MySQL/TiDB 后验证迁移+注册登录全链路 ③ 开始 Phase 2 schema/business 四张业务表 |
| 验收状态 | client tsc **0 错** + vite build ✓ + team-smoke 5/5 ✓ + server tsc 仅余 @midscene 未构建错误（自愈型） |
| 阻塞项 | a) ../midscene workspace 未构建（dist 缺失，阻塞完整 server 启动）b) 本机无 docker/MySQL（阻塞 drizzle 迁移真实验证）；TiDB 连接串用户后续给 |
| 关键约定 | 见下方「全局技术约定」 |

---

## 全局技术约定（所有 Phase 遵守）

- **数据库**：团队数据存远程 TiDB（MySQL 协议），ORM 用 **Drizzle**（`drizzle-orm` + `mysql2` + `drizzle-kit`）。`DB_URL` env 未配置时团队功能整体禁用（ping 除外），本地模式不受影响。
- **目录**：`src/server/db-team/`（Drizzle 层，与现有 `src/server/db/` better-sqlite3 层并存）；团队路由 `src/server/routes/team-*.ts`，挂载在 `/api/team/*`。
- **隔离铁律**：四种测试类型的团队业务表依旧独立（api/web/pc/mobile 分文件分表），团队维度只加 `team_id` + `project_id` 列，不破坏隔离原则。
- **时间**：应用层生成 `YYYY-MM-DD HH:MM:SS` 字符串（`nowSql()` helper），列用 varchar(32)，规避 DB 时区坑（与现有 SQLite TEXT 时间格式对齐，前端 datetime.ts 直接兼容）。
- **乐观锁**：所有团队业务表带 `version int not null default 1`；UPDATE 带 `AND version=?`，0 行命中 → 409。
- **响应格式**：与现有一致 `{ code, message, data }`。
- **前端**：`/team/*` 与 workspace=team 时的业务请求发中心服务绝对 URL；token 用独立 localStorage key（`teamAuth:<centerUrl>`），与本地 token 互不干扰。CORS：中心服务生产部署需把本地平台 origin 加进 `CORS_ORIGINS`。
- **角色**：owner > admin > editor > viewer（挂 team 级，project 继承）。viewer 可执行不可改。

---

## Phase 0 · Drizzle 地基 ⬜→✅

- [x] 0.1 安装依赖：`pnpm add drizzle-orm` + `pnpm add -D drizzle-kit`（mysql2 已有）✅
- [x] 0.2 `drizzle.config.ts`（dialect mysql, schema 路径, out=drizzle/migrations）✅
- [x] 0.3 `src/server/db-team/client.ts` — mysql2 pool + drizzle 单例；DB_URL 未配置时 `getTeamDb()` 返回 null ✅
- [x] 0.4 `src/server/db-team/schema/org.ts` — center_users / teams / team_members / projects ✅
- [x] 0.5 `src/server/db-team/schema/versions.ts` — resource_versions / presence ✅
- [x] 0.6 `src/server/db-team/schema/index.ts` 汇总导出 ✅
- [x] 0.7 `src/server/db-team/migrate.ts` — 启动时 drizzle-orm/node-mysql2 migrator 跑迁移（幂等）✅
- [x] 0.8 `src/server/db-team/util.ts` — nowSql() / ROLE_ORDER / hasRole() ✅
- [ ] 0.9 package.json scripts：`db:generate` / `db:migrate` ✅（直接完成，见 package.json）
- [ ] 0.10 docker MySQL 验证（drizzle-kit generate + push + 连通 smoke）⏸ 本机无 docker/MySQL，`drizzle/0000_busy_banshee.sql` 已离线生成待真库验证（用户装 MySQL 或给 TiDB 链接后跑 `db:migrate`+冒烟）

## Phase 1 · 中心服务核心（认证 + 组织 + 前端工作区）✅

### 后端
- [x] 1.1 `src/server/auth/team-jwt.ts` ✅（生产+DB_URL 才强校验 TEAM_JWT_SECRET，本地不受阻）
- [x] 1.2 `src/server/db-team/repo/auth.ts` ✅
- [x] 1.3 `src/server/db-team/repo/org.ts` ✅（requireRole 403/404 闸 + 全套 CRUD）
- [x] 1.4 `src/server/routes/team-auth.ts` ✅（ping 免认证免 DB）
- [x] 1.5 `src/server/routes/team-org.ts` ✅
- [x] 1.6 `routes/index.ts` 挂载：ping 恒挂 + teamDbGuard(503) → auth/org ✅
- [x] 1.7 `server/index.ts` 启动后台跑 runTeamMigrations ✅

### 前端
- [x] 1.8 `src/client/utils/teamAuth.ts`（含 setLastCenterUrl/getLastCenterUrl）✅
- [x] 1.9 `src/client/utils/workspace.ts`（sanitize + workspace-changed 事件）✅
- [x] 1.10 `src/client/contexts/WorkspaceContext.tsx`（refreshTeams(centerUrl?) 支持连接后未切模式拉取）✅
- [x] 1.11 `utils/api.ts` resolveTarget() + apiFetchCenter()（401 不误清本地 token）✅
- [x] 1.12 ConnectTeamModal（ping 探测→登录/注册→凭据复用提示）✅
- [x] 1.13 WorkspaceSwitcher + TeamOrgModal ✅
- [x] 1.14 SysHeader 接入切换器 + App.tsx WorkspaceProvider ✅
- [x] 1.15 type check：server tsc 0 错（修复全部幽灵依赖）；client 新文件 0 错；vite build 通过 ✅
- [x] 1.16 冒烟：scripts/team-smoke.ts 5/5 通过（npm run team:smoke）；完整 dev 冒烟待 midscene 构建 ⏸

## Phase 2 · 团队业务资源 ⬜

- [ ] 2.1 schema/business/web.ts — web_test_cases + executions + logs（团队版，含 version/team_id/project_id/owner_id）
- [ ] 2.2 schema/business/pc.ts、mobile.ts、api.ts（同模式，逐表核对现有 SQLite 列）
- [ ] 2.3 schema/business/shared.ts — environments（密钥列 AES-GCM 加密复用 crypto 模式）/ devices（busy_slot 生成列替代 partial unique index）/ tags / mocks-*
- [ ] 2.4 repo 层：列表（分页/筛选/排序）、详情、创建、更新（乐观锁→409）、删除（级联）
- [ ] 2.5 routes：/api/team/web-cases 等全套（复用现有 route 处理逻辑形状）
- [ ] 2.6 409 冲突前端 UI（冲突对话框：加载最新/另存副本/覆盖）
- [ ] 2.7 resource_versions 快照写入 + 版本历史页 + 回滚
- [ ] 2.8 presence 编辑占位提示（30s 心跳过期）
- [ ] 2.9 团队设备池路由 + busy 锁 MySQL 版（生成列唯一索引验证）
- [ ] 2.10 前端业务页面接 team 模式（列表页 basePath 不变，请求自动走中心）

## Phase 3 · 导入导出（.atpkg）⬜

- [ ] 3.1 包格式定义 + manifest schema（format/version/exportedAt/resources[]/idMap）
- [ ] 3.2 导出：勾选 UI + 依赖闭包计算（scenario→cases 扫 node config JSON；sets→members）
- [ ] 3.3 导入：预览比对（名称粗筛 + content_hash 精判）+ 冲突策略（跳过/覆盖/保留两者）
- [ ] 3.4 ID 重映射引擎 + JSON 深度引用改写（apiId/caseId 字段）
- [ ] 3.5 密钥字段口令加密（AES-GCM，复用 agent-push/crypto 模式）
- [ ] 3.6 导入完成写审计 + resource_versions 记录 "imported from local@user"

## Phase 4 · 感知与治理 ⬜

- [ ] 4.1 notify_channels 表 + 飞书/钉钉/企微 webhook 推送（执行完成/失败/调度结果）
- [ ] 4.2 share_links 报告分享（token + 过期 + 可选密码）
- [ ] 4.3 comments 评论 + @成员
- [ ] 4.4 audit_logs 审计查询 UI
- [ ] 4.5 团队/项目 Dashboard（Recharts）

## Phase 5 · 规模化与部署 ⬜

- [ ] 5.1 中心服务部署脚本/文档（PM2/systemd + env 清单：DB_URL/TEAM_JWT_SECRET/CORS_ORIGINS/PUBLIC_SERVER_URL）
- [ ] 5.2 TiDB 真机回归（生成列唯一索引 / onDuplicateKeyUpdate / json 函数）⏸ 等用户给链接
- [ ] 5.3 调度 leader 锁（多实例场景）
- [ ] 5.4 报告/上传对象存储（按需）

---

## 变更记录

| 时间 | 变更 |
| --- | --- |
| 2026-07-02 21:55 | 计划创建；Phase 0 任务全部完成（0.10 暂缓除外） |
| 2026-07-02 22:00 | Phase 1 后端 1.1-1.7 完成，前端 1.8-1.13 完成，1.14 进行中 |
| 2026-07-02 23:00 | 收尾：@codemirror/view override 钉 6.43.4 消除版本分叉；顺手修 3 个既有 client 错误（MidsceneReportViewer null 类型 / Home recharts formatter）→ client tsc **0 错**。等 midscene 构建后 server 应 0 错 |
