# auto-test-platform

自动化测试平台 - 支持接口 / Web / UI / 移动端 自动化测试,支持在远程机器上跑浏览器用例。

## 快速开始

```sh
npm install
npx playwright install chromium   # 本地浏览器二进制
npm run dev                       # 起 server + vite dev server(同进程)
```

访问 http://localhost:3000 ,默认账号在首次启动时打印到 server 日志。

## 项目结构

```
src/
├── server/        # Express + SQLite 后端,所有执行器和路由
│   ├── engine/    # api / web / pc / mobile 执行器
│   ├── routes/    # REST 端点
│   ├── scheduler/ # node-cron 调度(场景集 + 报告清理 + agent 心跳)
│   ├── devices/   # merge / ssh-tunnel(移动端本地+远端设备合并)
│   ├── mobile-preview/  # scrcpy / mjpeg / screenshot relay
│   ├── agent-push/      # bundler / ssh-client / push / crypto
│   └── db/        # better-sqlite3 表 + 访问函数
├── client/        # React + Vite 前端
├── agent-web/     # 远程 web agent 服务(独立 Node 进程,4001 端口,Playwright Chromium)
└── agent-mobile/  # 远程 mobile agent 服务(独立 Node 进程,4002 端口,Android/Harmony/iOS)
```

## 测试类型

| 类型 | 说明 | 执行器 |
|---|---|---|
| 接口 (api) | 用 YAML/JSON 描述 HTTP 请求,断言 JSON/状态码 | `engine/api-executor.ts` |
| Web | 用自然语言或 YAML 驱动 PlaywrightAgent,生成 Midscene HTML 报告 | `engine/web-executor.ts` |
| PC | 同上(headless Chromium 模拟) | `engine/pc-executor.ts` |
| 移动端 | 同上 | `engine/mobile-executor.ts` |

所有类型的用例、场景、场景集、调度都拆成独立的 4 套表(见 `src/server/db/`),
互不污染。

## Web 远程 Agent 部署

Web 用例默认在 server 所在机器上跑(`launcher.launchServer()` in-process)。
如果你需要在另一台机器(Windows / Linux / macOS 远端、CI runner)上跑 web 用例,
有两种部署方式:**SSH 集中推送**(默认推荐,平台一键搞定)和**手动部署**(开发/CI 备用)。

### 方式一:SSH 集中推送(推荐)

平台在用户点"重连/升级"按钮时,会通过 SSH 登录远端 Linux 机器,把
agent 源码 + node_modules + Chromium + systemd unit 一次性打包推过去,
远端自动解压、自动安装、注册成 systemd 服务 `auto-test-agent.service`。
整个过程不需要人 SSH 到机器上。

#### 1. server 端:配 SSH 加密密钥(只做一次)

```sh
# 32 字节 hex,跟 JWT secret 同等强度
export AGENT_SSH_KEY_SECRET=$(openssl rand -hex 32)
# 持久化到 .env / 系统环境变量,重启 server 后依然生效
```

如果这个 env 没设,server 启动时会打一条 warning,推送/停止端点会返 503;
其他功能(heartbeat、调度、执行器)不受影响。

#### 2. UI:添加 web 设备 + 填 SSH 信息

打开 UI → 系统管理 → 设备库 → `+ 添加设备`,类型选 **Web 测试**,保存。

然后点该设备的 `编辑` 按钮,展开 **SSH 配置**(默认折叠):

| 字段 | 说明 |
|---|---|
| `SSH Host` / `SSH Port` / `SSH User` | 远端机器地址 + 22/2222 + 用户名(需要能 `sudo`,详见下文) |
| `认证方式` | 密码 / 私钥二选一 |
| `密码` 或 `私钥` | 留空 = 保留原值(编辑模式);空字符串 = 清空 |
| `操作系统` | 现只支持 Linux;macOS/Windows 暂不支持(按钮会灰掉) |

**凭据安全**:密码和私钥在 server 端用 AES-256-GCM 加密存到 `devices` 表,
列名作为 AAD 防止密文被换列。**API 响应里不返回明文**,只在 Agent Info
弹窗里展示 `has_ssh_password` / `has_ssh_private_key` 两个布尔。

**用户权限要求**:SSH 登入的用户必须能 `sudo`(推送脚本里用 `sudo tee` 写
`/etc/auto-test-agent.env` 和 `/etc/systemd/system/auto-test-agent.service`)。
建议用 `root` 或专门的 sudoer 账号。

#### 3. UI:点"重连/升级" → 几分钟后远端跑起来

设备列表的每一行 web 设备都有 **重连/升级** 按钮(SSH 信息不全时灰掉),
点了之后:

1. server 把 `src/agent-web/` 源码 + `node_modules/` + `chromium-*` + systemd unit
   打成 tar.gz(~1.5GB),流式 SFTP 上传到 `/tmp/agent-bundle-<ts>.tar.gz`
2. 远端跑内联的 deploy 脚本:解压到 `-bundle-new` → sha256 校验 →
   原子切换(老目录改名为 `-old`、新目录切上来)→ 写 `/etc/auto-test-agent.env`
   → 写 systemd unit(`[ -f ... ]` 判断,只在不存在时写) → `daemon-reload` →
   `systemctl restart auto-test-agent`
3. agent 启动后立刻向 server `register` + 开始心跳,UI 上 30s 内变 `🟢 在线`
4. `devices.last_push_at` / `last_push_status` / `last_push_error` 落地,
   Agent Info 弹窗可以看到上一次推送的时间和错误

> **降级路径**:Windows / macOS 远端机器、或不想配 SSH,改用"方式二:手动部署"。

#### 4. 升级机制(Version Mismatch)

升级是个**显式**动作 —— server 不会自动 SSH 上去 restart 用户的远端进程。
流程:

1. server 升级到新版本(改了 `package.json` 的 `version`)
2. 远端 agent 还在跑老版本 → 它每次 `register`/`heartbeat` 时带上 `version`
3. server 端 `/api/agents/heartbeat` 检测到 version 不一致 → 返 **401**
   `{code: 401, message: "agent version mismatch: server requires X, agent has Y", required_version: X}`
4. agent 看到 401 → 打印升级提示 → `process.exit(1)`
5. server 把设备翻 `needs_upgrade=1`,UI 上设备名旁边出现 🆙 角标
6. 用户看到角标 → 点 **重连/升级** → server 推新版本 → 完成

server 启动时(`startScheduler()`)也会扫一遍所有 web 设备,version 不一致的
标记 `needs_upgrade=1`,不需要等下次心跳。

#### 5. 停止 / 重新调度

设备行还有 **停止** 按钮(只在 `status=online` 时显示),点了之后
server SSH 上去跑 `systemctl stop auto-test-agent.service`:
agent 收到 SIGTERM → 主动 `POST /api/agents/shutdown` → server 翻 offline
**不自动重拉**。再上线走 **重连/升级** 按钮。

#### 6. SSH 推送排错速查

| 现象 | 原因 |
|---|---|
| 按钮灰掉 | 设备类型不是 web,或 SSH 信息不全(host/user/auth_type 缺一) |
| `503 SSH push is disabled` | server 没设 `AGENT_SSH_KEY_SECRET` |
| `connect: connect ETIMEDOUT` | 防火墙挡 SSH 端口 |
| `All configured authentication methods failed` | 密码/私钥错 |
| `sudo: a password is required` | SSH 用的用户不在 sudoers,改成 root 或加 NOPASSWD |
| `systemctl: command not found` | 远端没装 systemd(非主流发行版) |
| agent 没自动起来 | 看 server 控制台 `[agent-push] deploy error: ...`,通常 sha256 失败或磁盘满 |
| `Permission denied (publickey)` | ssh_user / ssh_private_key 跟公钥指纹对不上 |

### 方式二:手动部署(开发 / CI 备用)

不走 SSH 推送,自己在远端机器上手动装。适合 CI runner、个人开发机、
不支持 systemd 的环境。

#### 1. 中央 server 端:创建 web 设备,拿到 token

打开 UI → 系统管理 → 设备库 → 右上角 `+ 添加设备`,类型选 **Web 测试**,保存。

设备列表 → 找到那条记录 → 点 `Agent` 按钮 → 弹窗里能看到:

- `Agent Token` (UUID, 点击复制)
- `Agent 部署命令` (预渲染好的一行命令,直接复制)

#### 2. 远程机器:装 agent

```sh
git clone <this-repo>            # 或单独拷 src/agent-web + package.json + tsconfig.agent.json
cd <this-repo>
npm install
npx playwright install chromium  # agent 必须有 chromium 二进制

# 填入步骤 1 拿到的两个值
export AGENT_TOKEN=<粘贴 token>
export AGENT_SERVER_URL=http://central-server:3000   # 改成你 server 的真实地址
export AGENT_PORT=4001            # 可选,默认 4001

npm run agent                    # dev 模式(热重启用 npm run dev:agent)
```

启动后 agent 会立刻 `POST /api/agents/register` 注册到 server,然后每 30s 一次心跳。
中央 server 调度器每分钟会扫一次 last_seen_at,>90s 没心跳就翻成 offline。

#### 3. 验证

- 中央 server 控制台:看到 `[agent:heartbeat] registered (status=200)`
- 中央 server UI:设备库 → 那条 web 设备状态变成 `🟢 在线`,`last_seen_at` 持续刷新
- 中央 server UI:Web 用例详情 → 顶部"执行设备"下拉会列出这个远程设备,选上 → 执行

#### 4. 常用运维

| 操作 | 命令 |
|---|---|
| 看 agent 日志 | `npm run agent`(前台) |
| 升级重启 | `Ctrl+C` 再 `npm run agent`(graceful shutdown 会主动通知 server 翻 offline) |
| 看活跃会话 | `curl http://agent-host:4001/healthz` → 返回 `activeSessions` 字段 |
| 换一台机器 | UI 设备库 → 编辑设备 → 改 `connection 地址`,再用新机器的 token 启动 agent |

#### 5. 排错速查

| 现象 | 原因 |
|---|---|
| agent 启动后 server 看不到 | `AGENT_SERVER_URL` 写错,或 4001 端口被防火墙挡 |
| UI 状态一直是 `⚫ 离线` | agent 没起来 / token 填错 / server 调度器还没扫(等最多 60s) |
| 用例报 `Agent disconnected` | agent 在用例中途挂了,server 端会标记该执行失败,重启 agent 再试 |
| `401 Unauthorized` | token 跟 server 数据库里那条设备对不上,重新从 UI 复制 |
| `playwright install` 失败 | agent 主机不能访问 playwright CDN,自行准备 `PLAYWRIGHT_BROWSERS_PATH` 指向内部镜像 |

### 安全提醒

- `AGENT_TOKEN` 是唯一的共享密钥,别提交到 git,别贴到群里
- `AGENT_SSH_KEY_SECRET` 跟 JWT secret 同等对待 —— **轮换会作废所有
  设备存的 SSH 凭据密文**,得让用户重填
- agent 的 4001 端口别直接暴露公网,放到内网/SSH 隧道/防火墙白名单
- 正式环境请把 server 和 agent 都套在 TLS 终止的 reverse proxy 后面

### 完整参考

- 协议细节、端点列表、环境变量、浏览器池策略 → `src/agent-web/README.md`
- 推送实现:`src/server/agent-push/`(bundler / ssh-client / push / crypto)
- 推送端点:`POST /api/devices/:id/push-agent` 和 `POST /api/devices/:id/stop-agent`
- 调度器、报告清理、token 生成细节 → `src/server/scheduler/scheduler.ts`
- 客户端实现 → `src/client/pages/system/DeviceList.tsx` / `WebCaseDetail.tsx`

## Mobile 远程 Agent 部署

移动端用例(server 端 Midscene 调用 adb/hdc/WDA 协议)支持在远端机器上跑:

| 平台 | 远端 OS | 工具链 | 端口 / 协议 | Server 端做法 |
|---|---|---|---|---|
| Android | Linux | adb-server | TCP 5037 | SSH LocalForward 5037 → 远端,`process.env.ADB_SERVER_SOCKET = "tcp:127.0.0.1:PORT"` |
| Harmony | Linux | hdc-server | TCP 5037(跟 adb 共用) | `process.env.HDC_SERVER_PORT = PORT` |
| iOS | macOS | WDA + xcrun simctl + idevicescreenshot | HTTP 8100 (WDA) | SSH LocalForward 8100 → 远端,`agentFromWebDriverAgent({wdaHost, wdaPort})` |

跟 web-agent 不同的地方:移动端**没有 HTTP 协议让 server 直连远端 adb 进程**,
adb/hdc/WDA 都是 TCP 长连接或 HTTP。Server 端用 SSH LocalForward(`ssh2.Client.forwardOut`)
把远端端口透到 `127.0.0.1:RANDOM`,然后当本地端口用 — 所有现有 Midscene 工厂函数
零修改。

`mobile-agent`(`src/agent-mobile/`,跟 `src/agent-web/` 平级)主要负责**屏幕预览传输**:
- Android: scrcpy H.264 → WebSocket(给前端 WebCodecs 解码)
- iOS: WDA MJPEG 或 xcrun simctl screenshot
- Harmony: hdc shell screencap 轮询(1 FPS)
- 设备列表:`POST /devices` 返回本机 adb/hdc/iOS 设备,server 在 agent
  register/heartbeat 时拉取,落到 `devices.metadata` JSON

### 方式一:SSH 集中推送(推荐)

跟 web-agent 一样,server 把 `src/agent-mobile/` 源码 + 共享 `node_modules/` 打成
tar.gz,通过 SSH 推过去。区别是**服务自启按远端 OS 分**:
- 远端 Linux:写 `/etc/systemd/system/auto-test-mobile-agent.service` + `systemctl restart`
- 远端 macOS:写 `/Library/LaunchDaemons/com.auto-test.mobile-agent.plist` + `sudo launchctl load -w`

#### 1. server 端:配 SSH 加密密钥(同 web-agent)

```sh
export AGENT_SSH_KEY_SECRET=$(openssl rand -hex 32)
```

#### 2. UI:添加 mobile 设备

打开 UI → 系统管理 → 设备库 → `+ 添加设备`,类型选 **Mobile 测试**,保存。

点该设备的 `编辑`,展开 **SSH 配置**:

| 字段 | 说明 |
|---|---|
| `SSH Host` / `SSH Port` / `SSH User` | 远端机器地址(Android/Harmony = Linux,iOS = Mac) |
| `认证方式` | 密码 / 私钥 |
| `操作系统` | **Linux (systemd)** 或 **macOS (launchd)** — iOS 选 macOS,Android/Harmony 选 Linux |

#### 3. UI:点"上线" / "下线"

设备列表行(mobile 设备现在也显示 push/stop 按钮)点 **上线** 后:

1. server 推同一份 tar.gz(包含 web + mobile 两套 agent 源码)
2. 远端跑 deploy 脚本:解压 → sha256 校验 → 原子 swap → 写 systemd unit 或
   launchd plist(幂等,只在不存在时写)→ 启动服务
3. macOS 上额外:`sudo touch /var/log/auto-test-agent.log && sudo chmod 666`,
   日志走 `tail -f /var/log/auto-test-agent.log`
4. mobile-agent 启动后 `POST /api/agents/register`,server 端立即 fire-and-forget
   调 `POST {agentEndpoint}/devices` 拉本机设备列表,写到 `devices.metadata`
5. **设备列表合并**:`/api/devices/merged?testType=mobile` 路由综合本地 adb/hdc +
   远端 mobile-agent 上报的设备,UI 的 DevicePickerModal 展示给用户选

#### 4. iOS 远端 — 额外要求

远端 macOS 机器必须装:

| 工具 | 用途 | 安装 |
|---|---|---|
| Xcode + Command Line Tools | `xcrun simctl`(模拟器) | `xcode-select --install`,再 App Store 装 Xcode |
| libimobiledevice | `idevice_id` / `idevicescreenshot` / `ideviceinfo`(真机) | `brew install libimobiledevice` |
| WebDriverAgent | WDA 监听 8100(真机必需) | `npm install -g appium-webdriveragent` 或 `brew install ios-deploy` |
| Node.js 18+ | 跑 mobile-agent | `brew install node` |

模拟器测试**不需要**真机 / WDA — `xcrun simctl list devices booted` 直接列
simulator;WDA 只在接真机时需要(`agentFromWebDriverAgent({wdaHost, wdaPort})` 走 8100)。

#### 5. 排错速查(mobile 专属)

| 现象 | 原因 / 解决 |
|---|---|
| 上线后 UI 设备列表空 | adb/hdc 没装,或 USB 设备没插。Mac server 看 `xcrun simctl list devices`,Linux server 看 `adb devices -l` |
| iOS 真机 case 报 `WDA not reachable` | 远端 Mac 没跑 WDA(`xcrun simctl listapps` 也要 WDA),或 8100 端口被防火墙挡 |
| Harmony 截图 1 FPS 太慢 | 故意行为(Harmony 只能 screencap,不能像 scrcpy 推 H.264 流) |
| 远端 macOS 上 launchctl 报 `service already bootstrapped` | plist 改完没 unload,deploy 脚本已处理;如果失败,`sudo launchctl unload <plist>` 后重试 |
| `/devices` 返回空但本机有设备 | 工具没在 PATH:Mac 装 Xcode CLT,Linux 装 android-platform-tools / hvigorw |
| 推送后 `last_push_status=error` 含 `systemctl: command not found` | 远端 OS 选错(Linux 机器上选了 macOS 不会失败,但 macOS 机器上选 Linux 会) |

### 方式二:手动部署

跟 web-agent 一样,远端手动 `git clone` + `npm install` + 跑 `npm run agent:mobile`
(`AGENT_TOKEN` / `AGENT_SERVER_URL` / `AGENT_MOBILE_PORT=4002` 三个 env 必填)。

iOS 额外:`AGENT_MOBILE_PLATFORM=ios` 不需要,代码里 `process.platform === 'darwin'`
自动启用 iOS 工具链(没装 Xcode 只是返回空列表,不会崩)。

### 完整参考(mobile)

- mobile-agent 实现:`src/agent-mobile/`(index / preview / scrcpy / ios-preview —
  协议跟 web-agent 同形:register / heartbeat / shutdown + bearer token)
- 推送实现:`src/server/agent-push/push.ts`(`pushMobileAgent` + `stopMobileAgent` 入口)
- 远端判定 + 隧道 + 三平台 dispatch:`src/server/engine/mobile-executor.ts:74-291`
- 设备合并:`src/server/devices/merge.ts`(local + 远端 metadata 归一)
- preview 中转:`src/server/mobile-preview/`(scrcpy-relay / mjpeg-relay / screenshot-relay)
- 客户端:`src/client/components/DevicePickerModal.tsx` + `MobilePreviewDrawer.tsx`

## 其它

- 用户文档见 `docs/`(api/scenario/执行日志等专题)
- 报告路径可每个用户单独配置,见 UI → 系统管理 → Midscene 配置
- PC 远程执行(ComputerAgent) 计划中,见 task #80
