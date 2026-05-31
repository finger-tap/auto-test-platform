# auto-test-platform 配置指南

## 数据库文件

### 实际使用的数据库

**路径：** `data/app.db`

```
data/app.db          ← 实际使用的 SQLite 数据库 (10MB+)
data/app.db-wal      ← WAL 模式写日志
data/app.db-shm      ← WAL 共享内存
```

其他同名 `.db` 文件都是历史遗留的空文件，可以删除：

```bash
rm -f data/auto_test.db data/auto-test.db data/test_platform.db data/test.db
```

### 数据库路径配置

修改 `src/server/db/index.ts` 第 14 行：

```typescript
const dbPath = path.join(dataDir, 'app.db');
```

改为其他文件名即可切换数据库，例如 `data/prod.db`。

### 切换到其他数据库

**方式 1：修改文件名**

```bash
# 备份当前数据库
cp data/app.db data/app.db.bak

# 切换到另一个数据库文件
# 编辑 src/server/db/index.ts 第14行，将 'app.db' 改为 'prod.db'
```

**方式 2：使用环境变量（需修改代码）**

在 `index.ts` 开头加入：

```typescript
const dbPath = path.join(dataDir, process.env.DB_NAME || 'app.db');
```

然后运行时指定：

```bash
DB_NAME=prod.db npm run dev
```

---

## 开发环境

### 启动开发服务器

```bash
npm run dev
# 访问 http://localhost:3000
# 自动打开浏览器
```

### 构建生产版本

```bash
npm run build
# 输出到 dist/ 目录
```

### 运行生产版本

```bash
npm run start
# 需要先 npm run build
```

---

## 环境变量配置

项目根目录无 `.env` 文件，以下为可选的配置项：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `DB_NAME` | `app.db` | 数据库文件名（需修改代码支持） |
| `NODE_ENV` | `development` | 运行环境 |

### 修改端口

方式 1：在 `package.json` 中修改 dev/start 脚本
方式 2：运行时指定 `PORT=8080 npm run dev`

---

## 垃圾文件清理

项目根目录的空文件（已删除）：

```
dev.db        ← 空文件，已删除
data.db       ← 空文件，已删除
server.log    ← 空文件，已删除
```

data/ 目录下的空文件（可删除）：

```
data/auto_test.db       ← 空文件，可删除
data/auto-test.db      ← 空文件，可删除
data/test_platform.db  ← 空文件，可删除
data/test.db           ← 空文件，可删除
```

```bash
rm -f data/auto_test.db data/auto-test.db data/test_platform.db data/test.db
```

---

## Git worktree 清理

`.claude/worktrees/` 目录下有两个废弃的 worktree，可以删除：

```bash
# 删除废弃 worktree（如果有未提交的改动会失败）
git worktree remove .claude/worktrees/priceless-golick-f3394e
git worktree remove .claude/worktrees/romantic-lederberg-15c4a9

# 查看当前 worktree 状态
git worktree list
```

---

## 数据库迁移

系统启动时会自动执行以下迁移：

### 表结构迁移（基于 tableMigrations）

为已存在的表添加新列，兼容旧数据库：
- `apis` → 添加 `created_by`, `updated_by`, `test_type`
- `scenarios` → 添加 `created_by`, `updated_by`, `parameters`, `test_type`
- `scenario_sets` → 添加 `created_by`, `updated_by`, `test_type`
- `environments` → 添加 `created_by`, `updated_by`, `test_type`
- `schedules` → 添加 `created_by`, `updated_by`, `test_type`
- `mock_endpoints` → 添加 `created_by`, `updated_by`, `test_type`
- `batch_reports` → 添加 `test_type`

> 注意：`mobile_test_cases`, `web_test_cases` 这类独立表无需通过 tableMigrations 迁移，它们在 SQL 建表语句中已定义完整结构。

### 其他迁移

- `scenario_nodes` → 添加 `pre_script`, `post_script`
- `mock_endpoints` → 添加 `status`, `tags`
- `environments` → 单 DB 字段迁移到多数据库 JSON 格式
- `environments` → 确保 `databases` 字段存在

---

## 四种测试类型的隔离

每个测试类型的后端完全隔离：

| 测试类型 | 用例表 | API 路由 |
|----------|--------|----------|
| API 测试 | `apis` | `/api/apis` |
| Web 测试 | `web_test_cases` | `/api/web-cases` |
| 移动端测试 | `mobile_test_cases` | `/api/mobile-tests` |
| PC 测试 | `pc_test_cases` | `/api/pc-cases` |

共享表（通过 `test_type` 列隔离）：
- `scenarios`, `scenario_sets`, `schedules`, `environments`, `mock_endpoints`, `batch_reports`