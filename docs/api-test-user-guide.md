# 接口测试用例功能手册

## 目录

1. [功能概述](#1-功能概述)
2. [数据模型](#2-数据模型)
3. [API 接口文档](#3-api-接口文档)
4. [功能使用指南](#4-功能使用指南)
5. [前后置动作](#5-前后置动作)
6. [断言规则](#6-断言规则)
7. [参数化配置](#7-参数化配置)
8. [执行与日志](#8-执行与日志)

---

## 1. 功能概述

接口测试用例模块用于创建、编辑和执行 HTTP API 测试，支持：

- **HTTP/WebSocket 协议**：支持 GET/POST/PUT/DELETE/PATCH 方法，以及 WebSocket
- **环境变量替换**：可在 URL、Headers、Body 中使用 `{{变量名}}` 引用环境变量
- **前后置动作**：支持脚本和数据库查询，支持独立设置提取/断言规则
- **断言验证**：支持状态码、响应头、响应体的提取和断言
- **参数化驱动**：支持 CSV 格式或手动输入多组参数，批量执行
- **步骤级日志**：完整记录每个执行步骤的请求、响应、提取值和断言结果

---

## 2. 数据模型

### 2.1 接口用例（ApiItem）

```typescript
interface ApiItem {
  id: number;
  user_id: number;
  name: string;                    // 用例名称
  method: string;                  // HTTP 方法：GET/POST/PUT/DELETE/PATCH
  url: string;                     // 请求地址，支持 {{变量名}} 替换
  protocol: string;                // 协议：http/https/ws/wss
  headers: string | null;          // 请求头（JSON 格式）
  body: string | null;             // 请求体
  description: string | null;       // 描述
  tags: string | null;              // 标签（逗号分隔）
  status: string;                   // 状态：active/draft
  content_type: string;            // 内容类型：json/form/xml/raw
  assertions: string | null;       // 主体断言规则（JSON 数组）
  pre_script: string | null;        // 前置脚本（已废弃，使用 pre_actions）
  post_script: string | null;      // 后置脚本（已废弃，使用 post_actions）
  pre_db_name: string | null;      // 前置数据库名称（已废弃）
  pre_db_query: string | null;     // 前置数据库查询（已废弃）
  post_db_name: string | null;     // 后置数据库名称（已废弃）
  post_db_query: string | null;    // 后置数据库查询（已废弃）
  pre_assertions: string | null;   // 前置断言规则（已废弃，使用 pre_actions 中的 rules）
  post_assertions: string | null;  // 后置断言规则（已废弃，使用 post_actions 中的 rules）
  final_assertions: string | null; // 最终断言规则（已删除）
  pre_actions: string | null;      // 前置动作列表（JSON 数组）
  post_actions: string | null;      // 后置动作列表（JSON 数组）
  parameters: string | null;        // 参数化配置（JSON）
  test_type: string;               // 测试类型：api
  created_at: string;
  updated_at: string;
}
```

### 2.2 前后置动作（PrePostAction）

```typescript
interface PrePostAction {
  id: string;
  name: string;           // 动作名称
  description?: string;
  type: 'script' | 'db';  // 动作类型：脚本或数据库
  script: string;          // 脚本内容（type=script 时使用）
  dbName: string;          // 数据库名称（type=db 时使用）
  dbQuery: string;         // SQL 查询语句（type=db 时使用）
  rules: AssertionRule[];    // 该动作的提取和断言规则
  alwaysRun?: boolean;     // 主体失败时是否仍执行（仅后置动作）
}
```

### 2.3 断言规则（AssertionRule）

```typescript
interface AssertionRule {
  name?: string;
  source: 'status' | 'header' | 'body' | 'vars';  // 提取来源
  key: string;                                     // 提取路径
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;                                // 期望值
  assert?: boolean;                               // true=断言检查，false=仅提取变量
}
```

**source 说明**：
- `status`：HTTP 状态码
- `header`：响应头，需设置 key 为 Header 名称
- `body`：响应体，支持点号路径如 `data.user.name`
- `vars`：变量，提取自前后置动作中设置的变量

### 2.4 参数化配置（ParametersConfig）

```typescript
interface ParametersConfig {
  enabled: boolean;
  source: 'csv' | 'manual';
  headers: string[];      // 列头，即变量名
  rows: string[][];       // 数据行
  enabledRows?: boolean[];
}
```

### 2.5 执行记录（ApiExecution）

```typescript
interface ApiExecution {
  id: number;
  api_id: number;
  scenario_log_id: number | null;
  scenario_id: number | null;
  node_id: string | null;
  param_row_index: number;      // 参数行索引，-1 表示非参数化执行
  status: string;               // success/failed/error
  trigger_type: string;         // 触发类型：manual/schedule/api
  executed_by: string | null;   // 执行人
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;           // ISO 时间（UTC）
  finished_at: string;
  steps?: ApiExecutionStep[];   // 步骤详情（按需加载）
}

interface ApiExecutionStep {
  id: number;
  api_execution_id: number;
  step_order: number;
  log_type: 'start' | 'pre_action' | 'main_action' | 'post_action' | 'error' | 'end';
  step_name: string | null;
  log_text: string | null;
  log_data: Record<string, unknown>;  // 各步骤详细数据
  created_at: string;
}
```

---

## 3. API 接口文档

> Base URL: `/api`  
> 认证方式：`Authorization: Bearer <token>`  
> 所有响应均为 JSON，格式为 `{ code: number, message: string, data?: T }`

### 3.1 用例管理

#### GET /api/apis

分页获取用例列表。

**Query Parameters**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 10 | 每页数量（最大100） |
| sort | string | updated_at | 排序字段：updated_at/created_at/name |
| order | string | DESC | 排序方向：ASC/DESC |
| test_type | string | api | 测试类型 |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "items": [/* ApiItem[] */],
    "total": 100,
    "page": 1,
    "pageSize": 10
  }
}
```

---

#### POST /api/apis

创建新用例。

**Request Body**:
```json
{
  "name": "获取用户信息",
  "method": "GET",
  "url": "https://api.example.com/users/{{user_id}}",
  "protocol": "https",
  "headers": "{\"Authorization\": \"Bearer {{token}}\"}",
  "body": "",
  "description": "获取用户基本信息",
  "tags": "用户,查询",
  "status": "active",
  "content_type": "json",
  "assertions": "[{\"name\":\"状态码\",\"source\":\"status\",\"key\":\"\",\"operator\":\"equals\",\"expected\":\"200\",\"assert\":true}]",
  "pre_actions": "[]",
  "post_actions": "[]",
  "parameters": "",
  "test_type": "api"
}
```

**Response**:
```json
{ "code": 201, "message": "Created", "data": { "id": 123 } }
```

---

#### GET /api/apis/:id

获取用例详情。

**Response**: 返回完整 `ApiItem` 对象。

---

#### PUT /api/apis/:id

更新用例。

**Request Body**: 同 POST，支持部分更新。

**Response**:
```json
{ "code": 200, "message": "Updated" }
```

---

#### DELETE /api/apis/:id

删除用例。

**Response**:
```json
{ "code": 200, "message": "Deleted" }
```

---

### 3.2 执行相关

#### POST /api/apis/:id/execute

执行用例。

**Request Body**:
```json
{
  "environmentId": 1  // 可选，环境配置 ID
}
```

**Response**（HTTP）:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 1,
    "api_id": 123,
    "status_code": 200,
    "request_headers": "{}",
    "request_body": null,
    "response_headers": "{}",
    "response_body": "{\"id\":1,\"name\":\"张三\"}",
    "duration_ms": 145,
    "executed_by": "admin",
    "assertion_results": {
      "pre": [],
      "main": [
        { "rule": { "name": "状态码", "source": "status", "key": "", "operator": "equals", "expected": "200", "assert": true }, "passed": true, "actual": "200" }
      ],
      "post": []
    },
    "param_summary": {
      "total_rows": 1,
      "results": [{ "row": 0, "status": 200, "duration_ms": 145, "passed": 1, "failed": 0 }]
    },
    "execution_id": 1
  }
}
```

---

#### GET /api/apis/:id/executions

获取执行历史列表（分页）。

**Query Parameters**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| limit | number | 20 | 返回数量（最大100） |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": [
    {
      "id": 22,
      "api_id": 7,
      "status": "error",
      "trigger_type": "manual",
      "executed_by": "admin",
      "duration_ms": 30008,
      "started_at": "2026-05-30T10:24:50.982Z",
      "finished_at": "2026-05-30T10:25:20.990Z"
    }
  ]
}
```

---

#### GET /api/apis/:id/executions/:execId

获取执行详情（含步骤）。

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 22,
    "api_id": 7,
    "status": "error",
    "trigger_type": "manual",
    "executed_by": "admin",
    "duration_ms": 30008,
    "started_at": "2026-05-30T10:24:50.982Z",
    "finished_at": "2026-05-30T10:25:20.990Z",
    "steps": [
      { "id": 156, "step_order": 1, "log_type": "start", "step_name": "开始", "log_text": "开始执行API: 测试", "log_data": { "api_id": 7, "api_name": "测试" } },
      { "id": 157, "step_order": 2, "log_type": "pre_action", "step_name": "前置动作", "log_text": "执行前置动作: 1 项", "log_data": { "actions": [{ "type": "script", "name": "设置变量", "rules": [...] }] } },
      { "id": 158, "step_order": 3, "log_type": "pre_action", "step_name": "设置变量", "log_text": "setVar(\"test_var\",\"hello\")", "log_data": { "script": "setVar(\"test_var\",\"hello\")", "script_success": true, "rules": [...], "assertion_results": [...] } },
      { "id": 159, "step_order": 4, "log_type": "main_action", "step_name": "主体请求", "log_text": "GET http://httpbin.org/get", "log_data": { "method": "GET", "url": "http://httpbin.org/get" } },
      { "id": 160, "step_order": 5, "log_type": "error", "step_name": "请求错误", "log_text": "请求错误", "log_data": { "error": "The operation was aborted due to timeout", "duration_ms": 30007 } },
      { "id": 161, "step_order": 6, "log_type": "end", "step_name": "完成", "log_text": "执行错误", "log_data": { "status": "error", "duration_ms": 30008 } }
    ]
  }
}
```

**步骤 log_data 说明**：

| 步骤类型 | log_data 关键字段 |
|---------|-----------------|
| start | api_id, api_name |
| pre_action（汇总） | actions: [{ type, content, name, dbName, rules }] |
| pre_action（单个动作） | script/script_success（脚本）或 db_name/query（数据库），rules, assertion_results |
| main_action | method, url, url_original, request_headers, request_body |
| error | error, duration_ms |
| end | status, duration_ms |

---

## 4. 功能使用指南

### 4.1 创建用例

1. 进入 **接口用例** 页面，点击 **新建用例**
2. 填写基本信息：
   - **用例名称**：必填，如「获取用户信息」
   - **请求方法**：GET/POST/PUT/DELETE/PATCH
   - **请求地址**：支持 `{{变量名}}` 占位符
   - **协议**：http/https/ws/wss
3. 配置请求内容：
   - **请求头**：JSON 格式，如 `{"Content-Type": "application/json"}`
   - **请求体**：根据 Content-Type 填写对应格式
   - **认证信息**：可放在请求头或使用环境变量

### 4.2 配置断言规则

在 **主体动作** 标签页添加断言规则：

| 字段 | 说明 |
|------|------|
| 名称 | 规则描述，如「状态码验证」 |
| 来源 | status（状态码）/ header（响应头）/ body（响应体） |
| 路径 | 来源为 header 时填 Header 名，为 body 时支持 `data.items[0].id` 格式 |
| 操作符 | equals/not_equals/contains/not_contains/less_than/greater_than/exists/not_exists |
| 期望值 | 期望的匹配值 |
| 提取/检查 | 开关控制：关闭为提取变量，开启为断言检查 |

### 4.3 使用前后置动作

在 **前置动作** / **后置动作** 标签页：

1. 点击 **添加动作**
2. 选择动作类型：**脚本** 或 **数据库**
3. 填写动作名称（可选，用于日志展示）
4. 编写脚本内容或 SQL 语句
5. 在规则区域添加该动作专属的提取/断言

**脚本动作**：
- 使用内置函数 `setVar(name, value)` 设置变量
- 使用 `getVar(name)` 读取变量
- 变量会注入到后续步骤的上下文中

**数据库动作**：
- 选择已配置的数据源
- 填写 SQL 查询语句
- 查询结果可用于断言（source=result/row_count）

**主体失败时仍执行**（仅后置动作）：
- 勾选后，即使主体请求失败也会执行此动作
- 用于清理操作或记录日志

### 4.4 参数化配置

在 **参数化** 标签页：

1. 开启参数化开关
2. 选择数据来源：**手动输入** 或 **CSV**
3. 设置变量名（表头）
4. 填入数据行

执行时，系统会按行依次执行，URL 和 Body 中的 `{{变量名}}` 会被替换为对应行的值。

### 4.5 执行与查看日志

1. 选择关联的环境（可选）
2. 点击 **执行** 按钮
3. 切换到 **执行记录** 标签查看历史
4. 点击某条记录的 **查看** 展开详情
5. 展开每个步骤查看：
   - 请求/响应详情
   - 提取的变量值
   - 断言结果（通过✓/失败✗/提取⊘）

---

## 5. 前后置动作

### 5.1 脚本动作

脚本在 Node.js 环境中执行，支持以下内置函数：

```javascript
// 设置变量（可在后续步骤使用）
setVar("token", "abc123");
setVar("user_id", 1001);

// 获取变量
const token = getVar("token");

// 当前环境变量
const baseUrl = env("BASE_URL");

// 前一个接口的响应数据
const prevData = prevApi("body");
const status = prevApi("status");
```

### 5.2 数据库动作

需在环境配置中先配置数据库连接：

```json
{
  "databases": [
    {
      "name": "用户库",
      "type": "mysql",
      "host": "localhost",
      "port": 3306,
      "user": "root",
      "password": "xxx",
      "database": "app_db"
    }
  ]
}
```

**SQL 查询结果提取**：

| source | 说明 | key 格式 |
|--------|------|---------|
| result | 查询结果数组 | 0 或 row.field |
| row_count | 结果行数 | 直接使用 |

---

## 6. 断言规则

### 6.1 断言与提取的区别

- **断言（assert=true）**：验证实际值是否符合期望，不匹配则用例失败
- **提取（assert=false）**：仅提取值存入变量，供后续使用，不影响用例状态

### 6.2 操作符说明

| 操作符 | 说明 | 示例 |
|--------|------|------|
| equals | 值等于期望 | actual == expected |
| not_equals | 值不等于期望 | actual != expected |
| contains | 字符串包含 | actual.includes(expected) |
| not_contains | 字符串不包含 | !actual.includes(expected) |
| less_than | 数值小于 | Number(actual) < Number(expected) |
| greater_than | 数值大于 | Number(actual) > Number(expected) |
| exists | 值存在且非空 | actual !== '' && actual !== 'undefined' |
| not_exists | 值不存在或为空 | actual === '' \|\| actual === 'undefined' |

### 6.3 body 路径提取

响应体为 JSON 时，支持点号路径：

| key | 说明 |
|-----|------|
| id | 提取根级字段 id |
| data.user.name | 提取嵌套字段 |
| items.0.name | 提取数组第一个元素的 name 字段 |
| items.\*.name | 提取所有元素的 name 字段（返回逗号分隔字符串） |

---

## 7. 参数化配置

### 7.1 手动输入模式

```
变量名: user_id, status
数据行:
  1001, active
  1002, inactive
  1003, active
```

### 7.2 CSV 模式

粘贴 CSV 内容，第一行自动识别为表头。

### 7.3 行启用控制

每行数据可通过启用/禁用开关控制是否执行。

---

## 8. 执行与日志

### 8.1 执行流程

```
1. 加载环境变量
2. 执行前置动作（按顺序）
   2.1 执行脚本/查询
   2.2 执行提取规则
   2.3 执行断言规则
3. 执行主体请求
   3.1 URL/Header/Body 变量替换
   3.2 发送 HTTP 请求
   3.3 执行主体断言规则
4. 执行后置动作（按顺序，仅主体成功或动作设置 alwaysRun 时）
5. 返回执行结果
```

### 8.2 状态码说明

| 状态 | 说明 |
|------|------|
| success | 主体请求成功（2xx），所有断言通过 |
| failed | 主体请求成功，但有断言失败 |
| error | 请求失败（网络错误/超时/非2xx且无对应断言） |

### 8.3 日志保留策略

- 默认保留最近 100 条执行记录
- 每条记录保留 6 个步骤（start/pre_action×N/main_action/error/end）
- 参数化执行合并为一条执行记录，step_order 从 1 开始递增

---

## 附录 A：错误排查

| 问题 | 可能原因 |
|------|---------|
| 请求超时 | 网络问题或目标服务响应慢，可调大环境 timeout |
| 变量未替换 | 环境变量名拼写错误，或变量未在环境中定义 |
| 断言失败 | 实际值与期望值不匹配，检查 actual 值 |
| 前置脚本错误 | 脚本语法错误或使用了未定义的函数 |
| 数据库连接失败 | 环境未配置数据库，或连接信息错误 |
| steps 为空 | 检查执行记录 ID 是否正确，或尝试重新执行 |

---

## 附录 B：相关文件

| 文件 | 说明 |
|------|------|
| `src/server/engine/api-executor.ts` | 执行引擎，核心逻辑 |
| `src/server/db/apis.ts` | 数据库操作 |
| `src/server/routes/apis.ts` | API 路由 |
| `src/client/pages/api-test/ApiDetail.tsx` | 前端详情页 |
| `src/client/components/PrePostActionItem.tsx` | 前后置动作组件 |
| `src/client/components/ApiExecutionTimeline.tsx` | 执行时间线组件 |
| `src/client/types/index.ts` | TypeScript 类型定义 |