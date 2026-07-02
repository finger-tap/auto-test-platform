![AutoTest Platform](./public/brand/autotest-logo-horizontal.png)

<p align="center">
  面向 API、Web、PC 桌面与移动端场景的一体化自动化测试平台。
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white" />
</p>

---

## 项目简介

AutoTest Platform 是一个自研自动化测试平台，提供从用例管理、场景编排、批量执行、定时调度、远程设备管理到执行报告查看的一整套能力。

平台覆盖四类测试：

- **API 接口测试**：HTTP / WebSocket 请求、断言、参数化、前后置脚本、数据库查询、Mock、OpenAPI 导入导出。
- **Web 自动化测试**：基于 Playwright 与 Midscene 的浏览器自动化，支持本机与远程 Web Agent 执行。
- **PC 桌面自动化测试**：面向 Windows / macOS / Linux 桌面应用场景，支持本机与远程 PC Agent 执行。
- **移动端自动化测试**：支持 Android / Harmony / iOS 设备接入、应用管理、实时预览与远程 Mobile Agent 执行。

项目采用前后端一体化架构：开发环境中 Express 与 Vite 运行在同一端口，生产环境由 Express 托管构建后的前端静态资源。

---

## 核心能力

### 1. 测试资产管理

- API / Web / PC / Mobile 四套独立用例体系。
- 支持标签、状态、描述、环境变量、参数化数据。
- 支持用例集、场景集、批量执行与历史执行记录。
- 支持不同测试类型下独立的环境配置和系统配置。

### 2. API 测试

- 支持 HTTP / HTTPS / WS / WSS。
- 支持 Header、Query、Body、Cookie、Content-Type 配置。
- 支持 JSONPath 断言、状态码断言、响应内容断言。
- 支持前置脚本、后置脚本、前置 / 后置数据库查询。
- 支持 Mock 服务与请求命中统计。
- 支持 OpenAPI 文档导入和导出。

### 3. Web 测试

- 基于 Playwright 执行浏览器自动化。
- 支持自然语言步骤与 Midscene 执行报告。
- 支持本地浏览器执行，也支持远程 Web Agent 执行。
- 支持浏览器配置、无头模式、窗口尺寸、基础 URL 等参数。

### 4. PC 桌面测试

- 支持 PC 桌面自动化用例的管理与执行。
- 按目标平台区分 Windows / macOS / Linux 配置项。
- 支持本机桌面执行与远程 PC Agent 执行。
- 支持远程 Agent 注册、心跳、版本校验、重连 / 升级。

### 5. 移动端测试

- 支持 Android / Harmony / iOS 移动自动化场景。
- 支持应用包管理、设备选择、实时预览、截图与报告。
- Android / Harmony 侧集成 ADB、scrcpy 相关能力。
- 支持远程 Mobile Agent 部署与回连。

### 6. 设备与 Agent 管理

- 设备库统一管理 Web / Mobile / PC 远程设备。
- 支持 SSH 推送 Agent 包、自动部署、服务注册与状态回报。
- 支持按 Agent 类型隔离远端部署目录，避免不同 Agent 包互相覆盖。
- 支持 Agent 版本不一致时提示升级，并通过平台 UI 触发重连 / 升级。

### 7. 调度与报告

- 支持定时执行测试集。
- 支持执行状态、耗时、结果统计和历史记录。
- 支持 Midscene HTML 报告查看。
- 后台包含报告清理、Agent 心跳扫描等调度任务。

---

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、Vite、TypeScript、React Router、CodeMirror、Recharts、@xyflow/react |
| 后端 | Node.js、Express、TypeScript、better-sqlite3、node-cron、ws |
| 自动化 | Playwright、Midscene Web / Android / iOS / Harmony / Computer |
| 远程部署 | ssh2、systemd、launchd、Node Runtime 打包、SFTP 上传 |
| 数据存储 | SQLite，本地文件数据库 |
| 构建 | Vite、TypeScript、tsx |

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm / pnpm 均可，当前仓库包含 `package-lock.json`，默认示例使用 npm
- 如需执行 Web 自动化，需要安装 Playwright 浏览器驱动
- 如需移动端能力，需要准备对应平台的设备、驱动或远程 Agent 环境

### 安装依赖

```bash
npm install
```

安装 Playwright 浏览器驱动：

```bash
npm run setup:drivers
```

### 启动开发环境

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

开发模式下，后端 Express 与前端 Vite 中间件运行在同一个服务中，接口与页面共用端口。

### 构建生产版本

```bash
npm run build
```

### 启动生产服务

```bash
npm run start
```

---

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发环境，后端与前端同端口运行 |
| `npm run dev:server` | 仅启动后端开发服务 |
| `npm run agent` | 启动 Web Agent |
| `npm run dev:agent` | 以 watch 模式启动 Web Agent |
| `npm run build` | 构建前端与服务端 |
| `npm run build:agent` | 构建 Web Agent |
| `npm run build:agent-mobile` | 构建 Mobile Agent |
| `npm run build:agent-pc` | 构建 PC Agent |
| `npm run start` | 启动生产服务 |
| `npm run start:agent` | 启动构建后的 Web Agent |
| `npm run test` | 运行后端 smoke 测试 |
| `npm run setup:drivers` | 安装 Playwright 驱动 |

---

## 目录结构

```text
.
├── public/                  # 静态资源与品牌资源
│   └── brand/               # Logo、图标、报告封面等品牌素材
├── src/
│   ├── client/              # React 前端应用
│   │   ├── components/      # 通用组件
│   │   ├── contexts/        # 鉴权、主题、环境等上下文
│   │   ├── pages/           # API / Web / PC / Mobile 各模块页面
│   │   ├── styles/          # 全局样式与模块样式
│   │   └── utils/           # 前端工具函数
│   ├── server/              # Express 后端
│   │   ├── agent-push/      # Agent 打包、SSH 推送、远端部署
│   │   ├── auth/            # 登录鉴权与 JWT 中间件
│   │   ├── db/              # SQLite 表结构与数据访问
│   │   ├── devices/         # 设备合并、隧道等能力
│   │   ├── engine/          # API / Web / PC / Mobile 执行器
│   │   ├── mobile-preview/  # 移动端预览、scrcpy、截图转发
│   │   ├── pc-preview/      # PC 预览会话管理
│   │   ├── routes/          # REST API 路由
│   │   └── scheduler/       # 定时任务、报告清理、心跳扫描
│   ├── agent-web/           # 远程 Web Agent
│   ├── agent-mobile/        # 远程 Mobile Agent
│   ├── agent-pc/            # 远程 PC Agent
│   └── shared/              # 前后端共享类型或工具
├── docs/                    # 规范、操作手册、数据库结构等文档
├── drivers/                 # Playwright 浏览器驱动缓存
├── data/                    # SQLite 数据库、上传文件等运行数据
├── scripts/                 # 开发、驱动安装、诊断脚本
└── dist/                    # 构建输出目录
```

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 否 | `3000` | 服务监听端口 |
| `NODE_ENV` | 否 | `development` | 运行环境 |
| `DATA_DIR` | 否 | `data` | 数据文件目录 |
| `JWT_SECRET` | 生产建议 | 内置开发兜底 | JWT 签名密钥，生产环境应显式配置 |
| `CORS_ORIGINS` | 生产建议 | localhost 白名单 | 生产环境允许的跨域来源，逗号分隔 |
| `PUBLIC_SERVER_URL` | 远程 Agent 建议 | 自动推断或手动配置 | Agent 回连中心服务的地址 |
| `AGENT_SSH_KEY_SECRET` | SSH 推送必填 | 无 | 用于加密保存设备 SSH 凭据，建议 32 字节 hex |
| `PLAYWRIGHT_BROWSERS_PATH` | 否 | `drivers` | Playwright 浏览器驱动目录 |

生成 SSH 凭据加密密钥示例：

```bash
export AGENT_SSH_KEY_SECRET=$(openssl rand -hex 32)
```

生产环境建议将关键环境变量写入进程管理器、容器环境或 `.env` 管理方案中。

---

## 数据与存储

默认使用 SQLite，本地数据库位于 `data/app.db`。

运行时还会在 `data/` 下保存上传文件、头像、报告引用等数据。该目录属于运行态数据，生产环境部署时应做好备份和权限控制。

---

## 远程 Agent 部署概览

平台支持通过设备库对远程 Agent 执行“重连 / 升级”。服务端会根据设备类型打包对应 Agent，并通过 SSH 推送到远端机器。

当前 Agent 类型与默认能力：

| Agent | 说明 | 默认端口 | 典型远端目录 |
| --- | --- | --- | --- |
| Web Agent | 执行浏览器自动化用例 | `4001` | `/opt/auto-test-agent` |
| Mobile Agent | 执行移动端自动化与预览相关能力 | `4002` | `/opt/auto-test-mobile` |
| PC Agent | 执行桌面自动化用例 | `4003` | `/opt/auto-test-pc` |

远程部署通常包含：

1. 在设备库中创建对应类型设备。
2. 配置 SSH Host、Port、User、密码或私钥。
3. 确保服务端已配置 `AGENT_SSH_KEY_SECRET`。
4. 在平台 UI 点击“重连 / 升级”。
5. 远端 Agent 启动后向中心服务注册并定时心跳。

Agent 与中心服务存在版本校验机制。如果中心服务版本升级，旧 Agent 心跳会收到版本不一致提示，此时需要在设备库中重新执行“重连 / 升级”。

---

## 开发说明

### 前端开发

前端入口：

```text
src/client/main.tsx
src/client/App.tsx
```

主要页面按测试类型拆分：

- `src/client/pages/api-test/`
- `src/client/pages/web-test/`
- `src/client/pages/pc-test/`
- `src/client/pages/mobile-test/`

通用样式集中在：

```text
src/client/styles/
src/client/components/
```

### 后端开发

后端入口：

```text
src/server/index.ts
```

路由统一挂载在：

```text
src/server/routes/index.ts
```

执行器位于：

```text
src/server/engine/
```

数据库访问位于：

```text
src/server/db/
```

### 数据库结构

数据库结构和部分说明可参考：

```text
docs/database-schema.sql
```

系统启动时会执行必要的表结构初始化和兼容迁移。

---

## 文档

| 文档 | 说明 |
| --- | --- |
| `docs/OPERATION_MANUAL.md` | 操作手册，覆盖主要功能入口与使用方式 |
| `docs/FRONTEND_STANDARDS.md` | 前端开发规范 |
| `docs/BACKEND_STANDARDS.md` | 后端开发规范 |
| `docs/CSS_STANDARDS.md` | CSS 与视觉规范 |
| `docs/database-schema.sql` | 数据库结构参考 |
| `DEPLOYMENT.md` | 部署与运行配置补充说明 |

---

## 推荐开发流程

1. 拉取代码并安装依赖。
2. 执行 `npm run setup:drivers` 安装浏览器驱动。
3. 执行 `npm run dev` 启动本地环境。
4. 修改前端、后端或 Agent 代码。
5. 根据修改范围执行构建验证：

```bash
npm run build
npm run build:agent
npm run build:agent-mobile
npm run build:agent-pc
```

如果只修改某个 Agent，可只执行对应的 `build:agent-*` 脚本。

---

## 适用场景

- 团队内部自动化测试平台建设。
- 多类型测试资产统一管理。
- Web / 桌面 / 移动端远程设备集中调度。
- AI 驱动的自然语言自动化执行验证。
- 需要 Mock、OpenAPI、批量执行和定时调度的一体化测试场景。

---

## License

当前项目为私有项目，使用前请确认团队内部授权与依赖许可要求。
