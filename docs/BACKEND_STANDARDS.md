# 后端开发规范

> 基于项目实际代码总结，供开发者和 coding agent 遵循。

## 技术栈

- **运行时**: Node.js >= 18, TypeScript (ESM 模块)
- **Web 框架**: Express 4
- **数据库**: SQLite (better-sqlite3)，单文件 `data/app.db`
- **认证**: JWT (jsonwebtoken)，Bearer token
- **浏览器驱动**: Playwright（Web/PC 测试执行）

## 目录结构

```
src/server/
├── index.ts              # 入口，Express 应用初始化
├── db/                   # 数据库层（每资源一个文件）
│   ├── index.ts          # 数据库连接 + 建表 + 迁移
│   ├── apis.ts           # API 用例 CRUD
│   ├── web-cases.ts      # Web 用例 CRUD
│   ├── environments.ts   # 环境管理 CRUD
│   └── ...
├── routes/               # 路由层（每资源一个文件）
│   ├── index.ts          # 路由汇总注册
│   ├── apis.ts           # /api/apis 路由
│   ├── web-cases.ts      # /api/web-cases 路由
│   └── ...
├── engine/               # 执行引擎
│   ├── api-executor.ts   # API 用例执行
│   ├── web-executor.ts   # Web 用例执行
│   └── ...
├── auth/                 # 认证中间件
│   ├── jwt.ts            # JWT 签发/验证
│   └── middleware.ts     # authMiddleware
└── utils/                # 工具函数
```

## 数据库规范

### 连接与初始化

```typescript
// src/server/db/index.ts
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 支持 DATA_DIR 环境变量（Electron 打包时指向 userData）
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../../data');
const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

// 启用 WAL 模式提升并发读性能
db.pragma('journal_mode = WAL');
```

### 建表规范

```sql
CREATE TABLE IF NOT EXISTS table_name (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_table_user ON table_name(user_id);
```

**要点：**
- 所有表必须有 `id`, `user_id`, `created_at`, `updated_at`
- 时间字段用 `TEXT` 存储 ISO 格式，使用 `+8 hours` 时区偏移
- 索引命名: `idx_{表名}_{列名}`

### 迁移规范

不使用迁移工具，直接在 `db/index.ts` 中用 PRAGMA + ALTER TABLE：

```typescript
const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!columns.some(col => col.name === 'account_type')) {
  db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'email'");
}
```

**要点：**
- 先查 `PRAGMA table_info` 判断列是否存在
- 存在则跳过，不存在则 `ALTER TABLE ADD COLUMN`
- 必须提供 `DEFAULT` 值处理已有数据

### CRUD 文件规范

每个资源一个文件，导出接口类型 + CRUD 函数：

```typescript
// src/server/db/web-cases.ts
import db from './index.js';

export interface WebCaseRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  // ... 所有字段，nullable 字段标记为 `| null`
  created_at: string;
  updated_at: string;
}

export interface CreateWebCaseInput {
  name: string;
  description?: string;
  status?: string;
  // ... 只包含创建时需要的字段
}

export function findWebCaseById(id: number, userId: number): WebCaseRow | undefined {
  return db.prepare('SELECT * FROM web_cases WHERE id = ? AND user_id = ?').get(id, userId) as WebCaseRow | undefined;
}

export function createWebCase(input: CreateWebCaseInput, userId: number): number {
  const result = db.prepare(
    'INSERT INTO web_cases (user_id, name, description, status) VALUES (?, ?, ?, ?)'
  ).run(userId, input.name, input.description ?? null, input.status ?? 'draft');
  return result.lastInsertRowid as number;
}
```

**要点：**
- 所有查询必须带 `user_id` 条件（数据隔离）
- 使用参数化查询 `?` 占位，禁止字符串拼接
- 返回 `undefined` 表示未找到（不是 `null`）
- `CREATE` 返回 `lastInsertRowid`

## 路由规范

### 基本结构

```typescript
// src/server/routes/web-cases.ts
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import { listWebCases, getWebCase, createWebCase, deleteWebCase } from '../db/web-cases.js';

export const webCaseRoutes = Router();
webCaseRoutes.use(authMiddleware);

// GET /api/web-cases — 列表查询
webCaseRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const filters = {
    name: req.query.name as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = listWebCases(req.user!.userId, page, pageSize, filters);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/web-cases — 创建
webCaseRoutes.post('/', (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }
  const id = createWebCase({ name: name.trim(), description }, req.user!.userId);
  res.json({ code: 200, message: 'ok', data: { id } });
});
```

### 统一响应格式

```typescript
// 成功
res.json({ code: 200, message: 'ok', data: result });

// 参数错误
res.status(400).json({ code: 400, message: 'Name is required' });

// 未找到
res.status(404).json({ code: 404, message: 'Not found' });

// 服务器错误
res.status(500).json({ code: 500, message: 'Internal server error' });
```

**要点：**
- 所有响应都是 `{ code, message, data? }` 信封格式
- 成功时 `code: 200`，`data` 包含实际数据
- 错误时 `code` 为 HTTP 状态码，`data` 为空
- 列表接口返回 `{ items, total, page, pageSize }`

### 路由注册

```typescript
// src/server/routes/index.ts
import { webCaseRoutes } from './web-cases.js';

export const routes = Router();
routes.use('/web-cases', webCaseRoutes);
routes.use('/apis', apiRoutes);
// ... 每个资源挂载到 /api/{resource}
```

## 4 种测试类型隔离模式

项目有 4 种测试类型（api / web / pc / mobile），隔离策略：

**完全隔离（独立表 + 独立路由）：**
- `web_cases` → `/api/web-cases`
- `pc_cases` → `/api/pc-cases`
- `mobile_tests` → `/api/mobile-tests`
- `case_sets_web` → `/api/case-sets-web`
- `schedule_sets_web` → `/api/schedule-sets-web`

**共享表（API 端仍在用）：**
- `apis`, `scenarios`, `scenario_sets` — 仅 API 测试使用
- `environments` — 4 种共用
- `tags` — 4 种共用

**新建资源时的隔离规则：**
- 如果资源只属于某一种测试类型，创建独立表 `xxx_{type}` 和独立路由文件
- 如果资源是跨类型共享的（如环境、标签），使用共享表

## 日志规范

### 关键路径必须打日志

```typescript
// 执行器入口
console.log(`[executor:web] Starting execution for case ${caseId}`);

// 执行结束
console.log(`[executor:web] Completed case ${caseId} in ${duration}ms, status=${result.status}`);

// 错误
console.error(`[executor:web] Failed case ${caseId}:`, error);
```

### 日志格式

- 带 `[模块名]` 前缀，如 `[executor:web]`, `[db]`, `[scheduler]`
- 关键节点：开始、结束、耗时、错误
- 可 grep：用一致的前缀格式

### 需要打日志的场景

- 异步操作开始/结束
- IO 操作（文件读写、网络请求）
- AI/外部服务调用
- 数据库迁移执行
- 定时任务触发
- 错误和异常

## 错误处理

### 路由层

```typescript
webCaseRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ code: 400, message: 'Invalid ID' });
    return;
  }
  const case_ = findWebCaseById(id, req.user!.userId);
  if (!case_) {
    res.status(404).json({ code: 404, message: 'Not found' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: case_ });
});
```

### 执行器层

```typescript
try {
  const result = await executeWebCase(caseId, options);
  // 记录执行结果
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : 'Unknown error';
  console.error(`[executor:web] Failed:`, errorMsg);
  // 记录错误状态
}
```

**要点：**
- 路由层验证输入，返回明确错误消息
- 执行器层 catch 所有异常，记录到数据库
- 不要静默吞掉错误

## 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `DATA_DIR` | 数据目录（DB、头像、报告） | `./data` |
| `PLAYWRIGHT_BROWSERS_PATH` | 浏览器驱动目录 | `./drivers` |
| `NODE_ENV` | 运行模式 | development |
| `JWT_SECRET` | JWT 密钥 | 内置默认值 |
| `AGENT_SSH_KEY_SECRET` | SSH 推送加密密钥 | 无（不设置则推送功能禁用） |

## ES 模块规范

```typescript
// 使用 .js 扩展名（ESM 要求）
import { findApiById } from '../db/apis.js';
import { authMiddleware } from '../auth/middleware.js';

// __dirname 替代方案
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**要点：**
- 所有 import 路径必须带 `.js` 后缀
- 不能直接用 `__dirname`，需要用 `fileURLToPath` 转换
- `package.json` 中 `"type": "module"`
