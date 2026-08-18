# 团队协作功能 · 部署与使用指南

> 团队协作让多人共享用例/场景/环境/设备等测试资产：个人空间（本地 SQLite）与团队空间（远程 TiDB）一键切换，带乐观锁防覆盖、版本历史/回滚、导入向导、成员权限、审计与群通知。

---

## 一、架构总览

```
浏览器（一个前端）
  │  workspace = local → 所有请求发本机实例（现状不变）
  │  workspace = team  → 业务请求发中心实例 + 团队 token + X-Team-Id/X-Project-Id
  ▼
中心实例 = 同一份代码部署，配置了 DB_URL
  ├─ /api/team/*            组织（账号/团队/成员/项目/审计/通知/导入）
  ├─ teamResourceDispatcher 业务 CRUD 直接读写 TiDB（Drizzle）
  └─ team-execute 执行镜像桥  团队用例执行时镜像到本机 SQLite →
                              复用全部现有执行器（Playwright/ADB/报告）→
                              执行记录读回时映射团队 ID
本地实例 = 不配 DB_URL，团队功能自动禁用，一切照旧
```

**关键设计：团队业务表列名与本地 SQLite 完全一致（snake_case），因此现有所有前端页面在团队模式下零改动工作。**

## 二、环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DB_URL` | 中心实例必填 | `mysql://user:pass@host:4000/autotest_team`。未配置 = 本地模式。启动时自动建库（`CREATE DATABASE IF NOT EXISTS`）并应用迁移 |
| `TEAM_JWT_SECRET` | 中心生产必填 | ≥32 字符。中心 JWT 签名密钥（与本地 JWT 独立）。`openssl rand -hex 32` 生成 |
| `CORS_ORIGINS` | 多实例部署建议 | 允许访问中心 API 的前端来源，逗号分隔。本地单实例开发无需配置（dev 反射任意来源） |
| `JWT_SECRET` | 生产建议 | 本地实例 JWT（原有变量，不变） |

`.env` 文件（gitignored）会被 `npm run dev` 自动加载，例如本地开发：

```bash
DB_URL=mysql://root@127.0.0.1:4000/autotest_team
```

## 三、本地开发（单机体验团队功能）

```bash
# 1. 启动本地 TiDB（固定端口 4000）
tiup playground v8.5.2 --db 1 --kv 1 --pd 1 --without-monitor --host 127.0.0.1

# 2. 项目根目录 .env 写入 DB_URL（见上），然后
npm run dev

# 3. 一键全链路验证（可选）
DB_URL=mysql://root@127.0.0.1:4000/autotest_team npm run team:verify-db
```

浏览器体验流程：
1. `http://localhost:3000` 登录本地账号
2. 顶栏工作区切换器 → **连接团队服务** → 地址 `http://localhost:3000` → 注册/登录中心账号
3. **＋ 新建团队** → 选择/新建项目
4. **⬆ 导入本机资源到当前项目**（三步向导：勾选 → 冲突策略 → 完成）
5. 团队模式下正常浏览/编辑/执行用例；**⚙ 团队管理** 管成员/通知渠道/审计
6. 详情页右下角浮钮：**👥 在线成员**（15s 心跳）＋ **🕘 版本历史/一键回滚**
7. 两人同时编辑同一用例：后保存者收到 409 冲突横幅「加载最新版本」

## 四、生产部署（中心实例）

```bash
# 构建（前端 + 服务端）
npm run build

# 运行中心实例（PM2 示例）
TEAM_JWT_SECRET=$(openssl rand -hex 32) \
DB_URL="mysql://user:pass@tidb-host:4000/autotest_team" \
CORS_ORIGINS="https://center.example.com,http://localhost:3000" \
NODE_ENV=production \
node dist/server/index.js
```

- 中心实例即是"团队数据的家"，也是**团队用例的执行宿主**（执行发生在中心机器上）
- 执行宿主的本地账号（第一个非 guest 用户）的 per-user 配置（Midscene 模型、浏览器配置）即团队执行所用的配置——在中心实例的个人空间里配置一次即可
- 多实例/高可用：目前单中心实例；调度 leader 锁与对象存储为后续项

## 五、成员与权限

| 角色 | 能力 |
| --- | --- |
| owner 所有者 | 管成员/删团队 + 全部 |
| admin 管理员 | 管成员/项目/通知渠道 + 全部 |
| editor 编辑者 | 增删改资源、执行、导入 |
| viewer 查看者 | 只读 + 可执行 |

- 角色挂团队级，项目继承；接口层 `requireRole`/`hasRole` 强制（403）
- 中心账号体系独立（center_users），与本地实例账号无关

## 六、并发保护与版本管理

- **乐观锁**：每次 GET 详情记录行版本；PUT 时版本不符 → `409` + 当前内容（前端弹全局冲突横幅）。PUT body 显式带 `version` 亦校验
- **版本历史**：每次内容变化写 `resource_versions` 快照（content-hash 去重，内容没变不烧版本号）；回滚 = 用旧快照创建新版本，历史永不改写
- **覆盖导入**：先把团队当前版备份进版本历史再覆盖——任何路径不丢数据

## 七、导入（.atpkg）

- 导出侧计算**依赖闭包**：场景集→场景→接口（深扫节点 config 里的 apiId）；用例集→用例；`depOf` 标注每项被谁带入
- 环境的敏感变量（password/secret/token 等命名）默认脱敏，勾选后包含
- 导入预览按（类型,名称）+ content_hash 三态：🆕 新增 / ⚠️ 冲突（跳过·覆盖·保留两者）/ =️ 相同跳过
- ID 重映射：拓扑序导入 + `scenario_ids`/`test_case_ids`/节点 config 深度改写，引用不断
- 也可 **⬇ 下载 .atpkg**（JSON）存档/转运

## 八、团队模式执行说明

- API/Web/PC/场景执行：在中心实例机器上执行（镜像桥，报告/环境变量/断言/参数化全功能）
- 移动端执行：需在团队设备库选择**远程 Agent 设备**（本机 USB 设备属于个人空间）
- 设备 SSH 推送/预览/刷新等运维操作：请在个人空间的设备库进行（团队模式明确返回 501）
- 执行记录/日志在团队模式下可正常查看（ID 自动映射）

## 九、运维

- 迁移：中心实例启动自动应用 `drizzle/` 下未应用的迁移（幂等）；新增 schema 后 `npm run db:generate` 生成迁移文件并提交
- 版本快照清理：保留每资源最近 50 版（`compactVersions`，可在调度器中定期调用）
- 审计：资源增删改/导入/回滚全量记录于 `t_audit_logs`，团队管理弹窗可查
- 群通知：支持飞书/钉钉（自动签名）/企业微信/Slack Webhook，资源变更实时推送

## 十、常见问题

**Q: 团队模式下登录页/个人设置还正常吗？**
A: 正常。`/auth/*`、模型配置、浏览器配置等身份类请求永远走本地实例（LOCAL_ONLY 白名单）。

**Q: 断开团队后数据去哪了？**
A: 团队数据都在 TiDB，本机不保留副本；切回个人空间即回到本地 SQLite，互不干扰。

**Q: 两个人同时保存同一用例？**
A: 后保存者收到冲突横幅（409），可选择「加载最新版本」重新编辑；先保存者的数据不会丢。

**Q: TiDB 报 "TEXT column can't have a default value"？**
A: 已修复（TEXT 默认值全部改为应用层注入）。若用旧版迁移文件初始化过库，删库重建或重跑 `npm run db:generate`。
