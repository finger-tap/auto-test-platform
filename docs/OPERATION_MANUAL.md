# Auto Test Platform - 操作手册

## 目录

1. [快速开始](#1-快速开始)
2. [用户管理](#2-用户管理)
3. [API 测试](#3-api-测试)
4. [Web 测试](#4-web-测试)
5. [PC 桌面测试](#5-pc-桌面测试)
6. [移动端测试](#6-移动端测试)
7. [用例集与批量执行](#7-用例集与批量执行)
8. [定时调度](#8-定时调度)
9. [设备管理](#9-设备管理)
10. [应用管理](#10-应用管理)
11. [环境管理](#11-环境管理)
12. [系统配置](#12-系统配置)
13. [仪表盘](#13-仪表盘)
14. [API 接口参考](#14-api-接口参考)

---

## 1. 快速开始

### 1.1 安装与启动

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器驱动
npm run setup:drivers

# 开发模式启动（前端热更新 + 后端自动重启）
npm run dev

# 生产模式
npm run build
npm run start
```

默认端口 `3000`，访问 `http://localhost:3000`。

### 1.2 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务端口，默认 3000 |
| `JWT_SECRET` | 生产环境 | JWT 签名密钥（最少 32 字符） |
| `CORS_ORIGINS` | 生产环境 | 允许的跨域来源，逗号分隔 |
| `PUBLIC_SERVER_URL` | 远程推送 | Agent 回连服务器地址 |
| `AGENT_SSH_KEY_SECRET` | SSH 推送 | SSH 凭据加密密钥 |

### 1.3 首次使用

1. 访问首页，点击"游客登录"快速体验
2. 或注册新账号
3. 选择测试类型（API / Web / PC / Mobile）进入对应模块

---

## 2. 用户管理

### 2.1 注册与登录

- **注册**：输入账号、密码、昵称（可选），支持上传头像
- **登录**：账号 + 密码登录
- **游客登录**：一键创建 guest 账户

### 2.2 个人设置

点击右上角头像 → 设置抽屉，包含：

- **个人信息**：修改昵称、邮箱、手机号
- **安全设置**：修改密码
- **设备库**：管理远程设备
- **模型配置**：Midscene AI 模型设置
- **浏览器配置**：Web 测试浏览器参数

---

## 3. API 测试

### 3.1 用例管理

**路径**：`/api-test/case`

**创建用例**：
- 基本信息：名称、描述、标签、状态
- 请求配置：协议（HTTP/HTTPS/WS/WSS）、方法（GET/POST/PUT/DELETE 等）、URL、请求头、请求体
- Content-Type：支持 JSON、Form、XML、Raw 等
- 断言：前置断言、后置断言、最终断言（JSONPath 提取 + 比较）
- 脚本：前置脚本、后置脚本（JavaScript 执行上下文）
- 数据库查询：前置/后置 DB 查询（支持 MySQL、PostgreSQL）
- 参数化：数据驱动，支持 CSV/JSON 参数

**执行用例**：
- 选择执行环境（环境变量替换 `{{variable}}`）
- 支持单个执行，返回结果 + 断言详情 + 执行时间线
- WebSocket 用例自动切换 ws/wss 协议

### 3.2 场景编排

**路径**：`/api-test/scene`

**可视化流程编辑器**：
- 基于 @xyflow/react 的节点图画布
- 节点类型：API 调用节点、条件分支节点、开始/结束节点
- 拖拽连线编排执行顺序
- 支持参数传递（上游响应 → 下游请求）

**执行场景**：
- 按流程图顺序执行所有节点
- 每个节点独立记录执行状态和耗时
- 条件分支根据表达式结果走不同路径

### 3.3 场景集（批量执行）

**路径**：`/api-test/case-set`

- 创建场景集，选择多个场景
- 批量执行：可选执行全部或勾选的场景
- 执行统计：按场景最新结果汇总（通过/失败/未执行）
- 导出 HTML 报告：蓝色顶栏 + 统计卡片 + 场景详情

### 3.4 Mock 服务

**路径**：`/api-test/mock`

- 创建 Mock 端点：路径模式匹配、HTTP 方法、响应状态码/头/体
- 响应延迟模拟（ms）
- 条件匹配：按请求参数返回不同响应
- 命中计数统计

### 3.5 OpenAPI 导入/导出

- **导入**：上传 JSON/YAML 文件，或输入 URL
- **预览确认**：导入前预览 API 列表，选择性导入
- **导出**：选中 API 导出为 OpenAPI 3.0 或 Postman 格式

---

## 4. Web 测试

### 4.1 用例管理

**路径**：`/web-test/case`

**创建用例**：
- 基本信息：名称、描述、标签、状态
- 测试步骤：自然语言描述（Midscene AI 解析执行）
- 检查点：断言条件（文本存在、元素可见、URL 匹配等）
- 前置条件：执行前需要完成的操作
- 浏览器配置：窗口大小、超时时间、无头模式、基础 URL
- 数据驱动：参数化测试数据

**执行用例**：
- 选择设备：本地浏览器或远程 Agent 设备
- Midscene 引擎解析自然语言步骤，自动操作浏览器
- 生成 Midscene HTML 报告（步骤截图 + AI 决策过程）
- 支持查看历史执行记录和报告

### 4.2 用例集

**路径**：`/web-test/case-set`

- 创建用例集，选择多个 Web 用例
- 批量执行 + 执行统计
- 支持定时调度

---

## 5. PC 桌面测试

### 5.1 用例管理

**路径**：`/pc-test/case`

**创建用例**：
- 基本信息：同 Web 测试
- 平台选择：macOS / Linux / Windows
- 桌面控制参数：
  - `display_id`：X11 显示编号
  - `keyboard_driver`：键盘驱动
  - `xvfb_resolution`：虚拟分辨率（Linux 无头）
  - `headless`：无头模式

**执行用例**：
- ComputerAgent 原生桌面控制（非浏览器模拟）
- 选择设备：本地执行或远程 Agent
- 实时桌面截图预览（SSE 流）
- Midscene 报告

### 5.2 远程 PC 执行

- 配置远程设备（SSH + Agent 推送）
- Agent 在远程机器执行，通过 SSE 回传桌面截图
- 支持 Xvfb 虚拟显示（Linux 无 GUI 环境）

---

## 6. 移动端测试

### 6.1 用例管理

**路径**：`/mobile-test/case`

**创建用例**：
- 基本信息：名称、描述、标签、状态
- 平台：Android / iOS / HarmonyOS
- 设备配置：设备名、系统版本、包名、Activity、Bundle ID
- Appium 配置：Appium Server URL、Capabilities JSON
- 测试步骤：自然语言（Midscene 移动端引擎）
- 检查点 + 前置条件 + 数据驱动

**执行用例**：
- 选择设备（本地 adb/hdc/iOS 或远程 Agent）
- 设备互斥锁：同一设备同时只能执行一个用例
- 自动安装关联的 APK/IPA/HAP（如已关联应用）
- 三种实时预览模式：
  - 截图模式（SSE，低带宽）
  - Scrcpy 模式（H.264 WebSocket，高画质）
  - MJPEG 模式（SSE，平衡）

### 6.2 用例集

**路径**：`/mobile-test/case-set`

- 同 Web/PC 用例集功能

---

## 7. 用例集与批量执行

### 7.1 用例集操作

每种测试类型（Web/PC/Mobile）都有独立的用例集：

1. **创建用例集**：输入名称、描述、选择用例
2. **编辑用例集**：增删用例、修改元信息
3. **执行用例集**：
   - 底部按钮自动判断：有勾选执行选中，无勾选执行全部
   - 显示"执行选中(N)"或"执行全部用例"
4. **查看执行历史**：每条记录包含状态、耗时、报告链接
5. **导出报告**：HTML 格式，可打印为 PDF

### 7.2 执行统计

- 列表页显示执行统计列：通过(绿)/失败(红)/未执行(灰)
- 统计粒度：按用例最新执行结果跨批次汇总
- 最近执行时间列

---

## 8. 定时调度

### 8.1 配置调度

**路径**：每种测试类型侧边栏 → "定时调度"

- 选择用例集/场景集
- 设置 Cron 表达式（5 位格式，时区 Asia/Shanghai）
- 启用/暂停/删除调度

### 8.2 Cron 表达式示例

| 表达式 | 含义 |
|--------|------|
| `0 9 * * *` | 每天 9:00 |
| `0 */2 * * *` | 每 2 小时 |
| `30 8 * * 1-5` | 工作日 8:30 |
| `0 0 * * 0` | 每周日 0:00 |

### 8.3 调度状态

- `active`：运行中，按 Cron 触发执行
- `paused`：已暂停，不触发
- `none`：未配置

### 8.4 后台任务

| 任务 | 时间 | 说明 |
|------|------|------|
| 报告清理 | 每天 03:17 | 删除 30 天前的 Midscene 报告 |
| Agent 心跳检查 | 每小时 :13 | 标记 90 秒无心跳的 Agent 为离线 |
| 版本扫描 | 启动时 | 检查 Agent 版本是否需要升级 |

---

## 9. 设备管理

### 9.1 设备类型

| 类型 | 发现方式 | 存储位置 | 说明 |
|------|----------|----------|------|
| 本地设备 | 自动发现（adb/hdc/idevice_id） | 内存 | 服务器本机连接的设备 |
| 远程设备 | 手动添加 | devices 表 | 通过 SSH + Agent 管理 |

### 9.2 添加远程设备

1. 进入设置 → 设备库 → 添加设备
2. 填写设备信息：
   - 名称、测试类型（web/pc/mobile）、平台
   - SSH 连接：主机、端口、用户名、认证方式（密码/密钥）
   - 操作系统类型（Linux/macOS）
3. 保存后获得 `agent_token`
4. 点击"推送 Agent"通过 SSH 部署 Agent 服务

### 9.3 Agent 推送流程

1. 服务器 SSH 连接目标设备
2. 打包 Agent 代码并上传
3. 安装为 systemd 服务
4. Agent 自动注册并开始心跳（30 秒间隔）
5. 服务器校验 Agent 版本，不匹配时标记 `needs_upgrade`

### 9.4 设备选择器

执行测试时弹出设备选择器：
- 展示所有可用设备（本地 + 远程合并视图）
- 显示设备状态（在线/离线）、忙碌状态（正在执行中）
- Web/PC 测试可选"本地执行"（不选设备）
- Mobile 测试必须选择设备

---

## 10. 应用管理

### 10.1 移动应用管理

**路径**：`/mobile-test/apps`

**创建应用**：
- 应用名称、平台（Android/iOS/HarmonyOS）、包名

**上传版本**：
- 支持 .apk / .ipa / .hap 文件（最大 500MB）
- 填写版本号、更新日志
- 文件存储：`data/mobile-apps/{app_id}/{version}/`

**安装到设备**：
- 选择目标设备
- 选择安装版本（默认最新版）
- 自动通过 adb/ideviceinstaller/hdc 安装

**关联用例**：
- 在用例详情 → 应用配置 tab 关联应用
- 可指定安装版本（空=最新版）
- 执行用例时自动安装关联的 App

---

## 11. 环境管理

### 11.1 环境配置

**路径**：每种测试类型侧边栏 → "环境管理"

**创建环境**：
- 名称、排序、是否默认
- 变量列表：`{ key, value, description, enabled }`
- SSL 客户端证书（PEM 格式）
- 请求超时时间（默认 30 秒）
- 数据库连接（支持多个 MySQL/PostgreSQL）

**变量替换**：
- 在 URL、请求头、请求体中使用 `{{variable_name}}`
- 执行时自动替换为环境变量值
- 已禁用的变量不参与替换

**数据库连接测试**：
- 保存前可点击"测试连接"验证数据库配置

---

## 12. 系统配置

### 12.1 Midscene 模型配置

**路径**：设置 → 模型配置

支持 3 个意图模型独立配置：

| 意图 | 用途 |
|------|------|
| 默认模型 | 主要执行意图 |
| 洞察模型 | 元素定位、断言判断 |
| 规划模型 | 动作分解、步骤规划 |

每个模型可配置：
- 模型名称、API Key、Base URL
- 模型家族（如 gpt-4、claude 等）
- 超时时间、温度
- 重试次数、重试间隔
- HTTP/SOCKS 代理
- 额外请求体 JSON
- 推理开关（reasoning_enabled/effort/budget）

全局配置：
- 首选语言
- 报告存储路径（绝对路径，需可写）
- 重规划周期限制
- 动作后等待时间
- 截图缩放因子

### 12.2 Web 浏览器配置

**路径**：设置 → 浏览器配置

- 驱动路径（自定义 Chrome/Chromium 路径）
- 用户数据目录
- 下载设置（是否接受下载、下载目录）
- Chromium 沙箱开关
- 执行后关闭浏览器
- 保持上下文存活
- 默认超时时间

---

## 13. 仪表盘

### 13.1 统计概览

**路径**：各测试类型首页

- 用例总数、用例集总数、通过率
- 跨类型聚合统计

### 13.2 最近执行

- 展示所有测试类型最近的批量执行记录
- 按时间倒序

### 13.3 执行趋势

- 最近 14 天（最多 30 天）每日通过/失败/总数
- 折线图展示

### 13.4 待办事项

- 简单的 Todo 列表
- 添加、完成、删除

---

## 14. API 接口参考

所有接口前缀 `/api`，需 JWT 认证（`Authorization: Bearer <token>`）。

### 14.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/guest` | 游客登录 |
| GET | `/api/auth/me` | 当前用户 |
| PUT | `/api/auth/profile` | 更新资料 |
| POST | `/api/auth/avatar` | 上传头像 |
| POST | `/api/auth/change-password` | 修改密码 |

### 14.2 API 测试

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/apis` | 列表/创建 |
| GET/PUT/DELETE | `/api/apis/:id` | 详情/更新/删除 |
| POST | `/api/apis/:id/execute` | 执行 |
| GET | `/api/apis/:id/executions` | 执行历史 |
| GET/POST | `/api/scenarios` | 场景列表/创建 |
| GET/PUT/DELETE | `/api/scenarios/:id` | 场景详情/更新/删除 |
| PUT | `/api/scenarios/:id/flow` | 保存流程图 |
| POST | `/api/scenarios/:id/execute` | 执行场景 |
| GET/POST | `/api/scenario-sets` | 场景集列表/创建 |
| POST | `/api/scenario-sets/:id/execute` | 批量执行 |
| GET | `/api/scenario-sets/:id/export-report` | 导出报告 |

### 14.3 Web 测试

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/web-cases` | 列表/创建 |
| GET/PUT/DELETE | `/api/web-cases/:id` | 详情/更新/删除 |
| POST | `/api/web-cases/:id/execute` | 执行 |
| GET/POST | `/api/case-sets-web` | 用例集列表/创建 |
| POST | `/api/case-sets-web/:id/execute` | 批量执行 |

### 14.4 PC 测试

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/pc-cases` | 列表/创建 |
| GET/PUT/DELETE | `/api/pc-cases/:id` | 详情/更新/删除 |
| POST | `/api/pc-cases/:id/execute` | 执行 |
| GET/POST | `/api/case-sets-pc` | 用例集列表/创建 |
| POST | `/api/case-sets-pc/:id/execute` | 批量执行 |

### 14.5 Mobile 测试

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/mobile-tests` | 列表/创建 |
| GET/PUT/DELETE | `/api/mobile-tests/:id` | 详情/更新/删除 |
| POST | `/api/mobile-tests/:id/execute` | 执行 |
| GET/POST | `/api/case-sets-mobile` | 用例集列表/创建 |
| POST | `/api/case-sets-mobile/:id/execute` | 批量执行 |

### 14.6 应用管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/mobile-apps` | 应用列表/创建 |
| GET/PUT/DELETE | `/api/mobile-apps/:id` | 详情/更新/删除 |
| POST | `/api/mobile-apps/:id/versions` | 上传版本 |
| DELETE | `/api/mobile-apps/:id/versions/:ver` | 删除版本 |
| POST | `/api/mobile-apps/:id/install` | 安装到设备 |

### 14.7 设备管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/devices` | 设备列表 |
| GET | `/api/devices/merged` | 合并设备列表（本地+远程） |
| POST | `/api/devices` | 添加设备 |
| PUT/DELETE | `/api/devices/:id` | 更新/删除 |
| POST | `/api/devices/:id/push-agent` | 推送 Web Agent |
| POST | `/api/devices/:id/push-mobile-agent` | 推送 Mobile Agent |
| POST | `/api/devices/:id/push-pc-agent` | 推送 PC Agent |
| GET | `/api/devices/:id/health` | 健康检查 |

### 14.8 环境与配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/environments` | 环境列表/创建 |
| GET/PUT/DELETE | `/api/environments/:id` | 详情/更新/删除 |
| POST | `/api/environments/test-db` | 测试数据库连接 |
| GET/PUT | `/api/midscene-config` | Midscene 配置 |
| GET/PUT | `/api/web-browser-config` | 浏览器配置 |

### 14.9 调度

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schedule-sets-{type}` | 调度列表 |
| PUT | `/api/schedule-sets-{type}/set/:setId` | 创建/更新调度 |
| POST | `/api/schedule-sets-{type}/:id/pause` | 暂停 |
| POST | `/api/schedule-sets-{type}/:id/resume` | 恢复 |
| POST | `/api/schedule-sets-{type}/:id/remove` | 删除 |

### 14.10 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/stats` | 仪表盘统计 |
| GET | `/api/dashboard/trend` | 执行趋势 |
| GET/POST | `/api/tags` | 标签管理 |
| GET/POST | `/api/mocks-api` | Mock 端点 |
| POST | `/api/openapi/import-file` | OpenAPI 导入 |
| GET | `/api/openapi/export` | OpenAPI 导出 |
| GET | `/api/health` | 健康检查 |

---

## 附录：数据库表清单

完整建表 SQL 见 `scripts/database-schema.sql`。

| 分类 | 表名 |
|------|------|
| 用户 | `users`, `user_tags` |
| API 测试 | `apis`, `api_executions`, `api_execution_steps`, `scenarios`, `scenario_nodes`, `scenario_edges`, `scenario_logs`, `scenario_executions`, `scenario_execution_steps`, `scenario_api_execution_links`, `scenario_sets`, `scenario_set_executions`, `scenario_set_execution_items` |
| Web 测试 | `web_test_cases`, `web_case_executions`, `web_case_logs`, `web_browser_config` |
| PC 测试 | `pc_test_cases`, `pc_case_executions`, `pc_case_logs` |
| Mobile 测试 | `mobile_test_cases`, `mobile_case_executions`, `mobile_case_execution_preview`, `mobile_test_logs`, `mobile_apps` |
| 用例集 | `case_sets_web`, `case_sets_pc`, `case_sets_mobile`, `case_set_executions_{type}`, `case_set_execution_items_{type}` |
| 调度 | `schedule_sets_api`, `schedule_sets_web`, `schedule_sets_pc`, `schedule_sets_mobile` |
| 批量报告 | `batch_reports_api`, `batch_reports_web`, `batch_reports_pc`, `batch_reports_mobile` |
| Mock | `mock_endpoints_api` |
| 设备 | `devices` |
| 配置 | `environments`, `midscene_config`, `pending_items`, `tags` |
