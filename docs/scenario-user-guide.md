# 场景列表功能手册

## 目录

1. [功能概述](#1-功能概述)
2. [数据模型](#2-数据模型)
3. [API 接口文档](#3-api-接口文档)
4. [功能使用指南](#4-功能使用指南)
5. [场景集](#5-场景集)
6. [执行与日志](#6-执行与日志)

---

## 1. 功能概述

场景模块用于将多个接口用例串联成业务流程，支持：

- **流程编排**：通过可视化节点编辑器编排场景流程
- **节点类型**：开始节点、API 节点、条件节点、结束节点
- **条件分支**：支持 If/Else 条件判断，控制执行路径
- **变量传递**：前一个 API 的响应可作为后续 API 的输入
- **场景集**：将多个场景打包为场景集，批量执行
- **参数化驱动**：场景级别的参数化配置，批量执行多组数据
- **步骤级日志**：完整记录每个节点的执行详情、提取值和断言结果

---

## 2. 数据模型

### 2.1 场景（Scenario）

```typescript
interface Scenario {
  id: number;
  user_id: number;
  name: string;           // 场景名称
  description: string | null;
  status: string;          // active/disabled/draft
  tags: string | null;       // 逗号分隔标签
  parameters: string | null; // 参数化配置（JSON）
  test_type: string;        // api/web/pc/mobile
  created_at: string;
  updated_at: string;
}
```

### 2.2 场景节点（ScenarioNode）

```typescript
interface ScenarioNode {
  id: number;
  scenario_id: number;
  node_id: string;           // 节点唯一标识（UUID）
  type: 'start' | 'api' | 'condition' | 'end';
  position_x: number;
  position_y: number;
  label: string | null;       // 节点显示名称
  config: string | null;      // 节点配置（JSON），存储 API ID、提取规则、断言规则等
}
```

### 2.3 节点配置（ApiNodeConfig）

```typescript
interface ApiNodeConfig {
  node_id?: string;
  api_id: number;            // 关联的 API ID
  api_name?: string;
  extractions?: ExtractRule[];  // 提取规则
  assertions?: AssertionRule[];   // 断言规则
  override_headers?: string;     // 覆盖请求头（JSON）
  override_body?: string;       // 覆盖请求体
  pre_script?: string;          // 前置脚本
  post_script?: string;         // 后置脚本
}

interface ExtractRule {
  var_name: string;           // 变量名
  source: 'status' | 'header' | 'body' | 'vars' | 'result';
  key: string;                // 提取路径
}

interface ConditionNodeConfig {
  condition_expr: string;     // 条件表达式，如：vars.count > 0
}
```

### 2.4 场景集（ScenarioSet）

```typescript
interface ScenarioSet {
  id: number;
  user_id: number;
  name: string;             // 场景集名称
  description: string | null;
  tags: string | null;
  status: string;           // active/disabled/draft
  scenario_ids: string;      // JSON 数组，如 [1, 2, 3]
  test_type: string;         // api/web/pc/mobile
  created_at: string;
  updated_at: string;
}
```

### 2.5 执行记录

```typescript
interface ScenarioExecution {
  id: number;
  scenario_id: number;
  status: string;            // success/failed/error
  trigger_type: string;       // manual/schedule/api
  executed_by: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  steps?: ScenarioExecutionStep[];
  api_links?: ScenarioApiExecutionLink[];
}

interface ScenarioExecutionStep {
  id: number;
  scenario_execution_id: number;
  step_order: number;
  log_type: string;           // scenario_start/node_start/node_end/condition/scenario_end
  node_id: string | null;
  node_type: string | null;
  log_text: string | null;
  log_data: Record<string, unknown>;
  created_at: string;
}

interface ScenarioSetExecution {
  id: number;
  set_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  total_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  total_duration_ms: number | null;
  started_at: string;
  finished_at: string;
  items?: ScenarioSetExecutionItem[];
}

interface ScenarioSetExecutionItem {
  id: number;
  set_execution_id: number;
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  scenario_execution_id: number | null;
}
```

---

## 3. API 接口文档

> Base URL: `/api`  
> 认证方式：`Authorization: Bearer <token>`  
> 所有响应均为 JSON，格式为 `{ code: number, message: string, data?: T }`

---

### 3.1 场景管理

#### GET /api/scenarios

分页获取场景列表。

**Query Parameters**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 10 | 每页数量（最大100） |
| sort | string | updated_at | 排序字段 |
| order | string | DESC | 排序方向 |
| test_type | string | api | 测试类型 |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "items": [/* Scenario[] */],
    "total": 50,
    "page": 1,
    "pageSize": 10
  }
}
```

---

#### POST /api/scenarios

创建新场景。

**Request Body**:
```json
{
  "name": "用户注册流程",
  "description": "包含注册、登录、获取token",
  "status": "active",
  "tags": "用户,注册",
  "test_type": "api"
}
```

**Response**:
```json
{ "code": 201, "message": "Created", "data": { "id": 10 } }
```

> 新建场景会自动创建 `start` 和 `end` 两个默认节点。

---

#### GET /api/scenarios/:id

获取场景详情（包含节点和连线）。

**Query Parameters**:
| 参数 | 类型 | 说明 |
|------|------|------|
| test_type | string | 可选，指定测试类型 |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "scenario": { /* Scenario */ },
    "nodes": [/* ScenarioNode[] */],
    "edges": [/* ScenarioEdge[] */]
  }
}
```

---

#### PUT /api/scenarios/:id

更新场景基本信息。

**Request Body**:
```json
{
  "name": "用户注册流程（优化版）",
  "description": "更新了登录逻辑",
  "status": "active",
  "tags": "用户,注册,优化"
}
```

**Response**:
```json
{ "code": 200, "message": "Updated" }
```

---

#### DELETE /api/scenarios/:id

删除场景。

**Response**:
```json
{ "code": 200, "message": "Deleted" }
```

---

### 3.2 流程管理

#### PUT /api/scenarios/:id/flow

保存场景流程（节点和连线）。

**Request Body**:
```json
{
  "nodes": [
    { "node_id": "start", "type": "start", "position_x": 250, "position_y": 50, "label": "开始" },
    { "node_id": "api1", "type": "api", "position_x": 250, "position_y": 150, "label": "注册用户", "config": "{\"api_id\": 1, \"extractions\": [...], \"assertions\": [...]}" },
    { "node_id": "end", "type": "end", "position_x": 250, "position_y": 400, "label": "结束" }
  ],
  "edges": [
    { "edge_id": "e1", "source_node_id": "start", "target_node_id": "api1" },
    { "edge_id": "e2", "source_node_id": "api1", "target_node_id": "end" }
  ]
}
```

**Response**:
```json
{ "code": 200, "message": "Flow saved" }
```

---

### 3.3 执行相关

#### POST /api/scenarios/:id/execute

执行场景。

**Request Body**:
```json
{
  "environmentId": 1  // 可选，环境配置 ID
}
```

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "execution_id": 5,
    "scenario_id": 10,
    "status": "success",
    "trigger_type": "manual",
    "executed_by": "admin",
    "duration_ms": 1234,
    "error_message": null,
    "started_at": "2026-05-30T10:00:00.000Z",
    "finished_at": "2026-05-30T10:00:01.234Z",
    "node_results": [
      { "node_id": "api1", "status": "success", "api_id": 1, "duration_ms": 200 },
      { "node_id": "api2", "status": "success", "api_id": 2, "duration_ms": 150 }
    ]
  }
}
```

---

#### GET /api/scenarios/:id/executions

获取场景执行历史。

**Query Parameters**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| limit | number | 20 | 返回数量 |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": [/* ScenarioExecution[] */]
}
```

---

#### GET /api/scenarios/:id/executions/:execId

获取场景执行详情（含步骤）。

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 5,
    "scenario_id": 10,
    "status": "success",
    "trigger_type": "manual",
    "executed_by": "admin",
    "duration_ms": 1234,
    "started_at": "2026-05-30T10:00:00.000Z",
    "finished_at": "2026-05-30T10:00:01.234Z",
    "steps": [
      { "id": 1, "step_order": 1, "log_type": "scenario_start", "node_id": "start", "node_type": "start", "log_text": "开始执行场景", "log_data": { "scenario_id": 10 } },
      { "id": 2, "step_order": 2, "log_type": "node_start", "node_id": "api1", "node_type": "api", "log_text": "执行节点：注册用户", "log_data": { "api_id": 1, "api_name": "注册用户" } },
      { "id": 3, "step_order": 3, "log_type": "node_end", "node_id": "api1", "node_type": "api", "log_text": "节点执行成功", "log_data": { "status": "success", "duration_ms": 200, "status_code": 200 } },
      { "id": 4, "step_order": 4, "log_type": "scenario_end", "node_id": "end", "node_type": "end", "log_text": "场景执行完成", "log_data": { "status": "success", "duration_ms": 1234 } }
    ],
    "api_links": [
      { "node_id": "api1", "param_row_index": null, "api_execution_id": 22 },
      { "node_id": "api2", "param_row_index": null, "api_execution_id": 23 }
    ]
  }
}
```

---

### 3.4 场景集管理

#### GET /api/scenario-sets

分页获取场景集列表。

**Query Parameters**:
| 参数 | 类型 | 说明 |
|------|------|------|
| name | string | 按名称模糊搜索 |
| tags | string | 按标签筛选 |
| status | string | 按状态筛选 |
| test_type | string | 测试类型 |

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "items": [/* ScenarioSet[] */],
    "total": 10,
    "page": 1,
    "pageSize": 10
  }
}
```

---

#### POST /api/scenario-sets

创建场景集。

**Request Body**:
```json
{
  "name": "用户模块测试集",
  "description": "包含用户注册、登录、信息查询等场景",
  "scenario_ids": [1, 2, 3],
  "tags": "用户,回归测试",
  "status": "active",
  "test_type": "api"
}
```

**Response**:
```json
{ "code": 201, "message": "Created", "data": { "id": 5 } }
```

---

#### GET /api/scenario-sets/:id

获取场景集详情（包含场景列表）。

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 5,
    "name": "用户模块测试集",
    "scenario_ids": [1, 2, 3],
    "scenarios": [/* Scenario[] */],
    "status": "active",
    "tags": "用户,回归测试"
  }
}
```

---

#### PUT /api/scenario-sets/:id

更新场景集。

**Request Body**: 同 POST，支持部分更新。

**Response**:
```json
{ "code": 200, "message": "Updated" }
```

---

#### DELETE /api/scenario-sets/:id

删除场景集。

**Response**:
```json
{ "code": 200, "message": "Deleted" }
```

---

### 3.5 场景集执行

#### POST /api/scenario-sets/:id/execute

批量执行场景集。

**Request Body**:
```json
{
  "environmentId": 1  // 可选，环境配置 ID
}
```

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "set_execution_id": 3,
    "status": "success",
    "total_count": 3,
    "passed_count": 2,
    "failed_count": 1,
    "skipped_count": 0,
    "total_duration_ms": 5000
  }
}
```

---

#### GET /api/scenario-sets/:id/executions

获取场景集执行历史。

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": [/* ScenarioSetExecution[] */]
}
```

---

#### GET /api/scenario-sets/:id/executions/:execId

获取场景集执行详情（含每个场景的执行结果）。

**Response**:
```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 3,
    "set_id": 5,
    "status": "success",
    "total_count": 3,
    "passed_count": 2,
    "failed_count": 1,
    "skipped_count": 0,
    "total_duration_ms": 5000,
    "started_at": "2026-05-30T10:00:00.000Z",
    "finished_at": "2026-05-30T10:00:05.000Z",
    "items": [
      { "scenario_id": 1, "scenario_name": "用户注册流程", "status": "success", "duration_ms": 1200 },
      { "scenario_id": 2, "scenario_name": "用户登录流程", "status": "success", "duration_ms": 800 },
      { "scenario_id": 3, "scenario_name": "获取用户信息", "status": "failed", "duration_ms": 3000, "error_message": "断言失败" }
    ]
  }
}
```

---

## 4. 功能使用指南

### 4.1 创建场景

1. 进入 **场景列表** 页面，点击 **新增**
2. 填写场景名称和描述，选择状态
3. 进入场景详情页，使用 **节点编辑器** 编排流程

### 4.2 节点编辑器

场景使用流程图形式的节点编辑器，支持以下节点类型：

| 节点类型 | 说明 |
|---------|------|
| start | 开始节点（自动创建，不可删除） |
| end | 结束节点（自动创建，不可删除） |
| api | API 调用节点，关联一个接口用例 |
| condition | 条件节点，支持 If/Else 分支 |

**添加 API 节点**：
1. 从左侧组件面板拖入 **API 节点**
2. 点击节点，选择关联的接口用例
3. 配置该节点的提取规则和断言规则
4. 连接节点（从输出锚点拖到输入锚点）

**条件节点配置**：
- 条件表达式支持变量引用，如 `vars.count > 0`
- 根据条件结果选择不同分支执行

### 4.3 节点级提取和断言

每个 API 节点可独立设置：

**提取规则**（`extractions`）：
```json
[
  { "var_name": "user_token", "source": "body", "key": "data.token" },
  { "var_name": "user_id", "source": "body", "key": "data.id" }
]
```

**断言规则**（`assertions`）：
```json
[
  { "name": "状态码", "source": "status", "key": "", "operator": "equals", "expected": "200", "assert": true },
  { "name": "token存在", "source": "body", "key": "data.token", "operator": "exists", "expected": "", "assert": true }
]
```

**变量传递**：提取的变量自动注入到后续节点的上下文中，可通过 `{{变量名}}` 在 URL、Header、Body 中使用。

### 4.4 参数化配置

场景支持参数化执行，在场景详情页的 **参数化** 标签页：

1. 开启参数化开关
2. 设置变量名（列头）
3. 填入数据行

执行时，系统会按行依次执行所有 API 节点，每行的变量值会替换到对应的请求中。

---

## 5. 场景集

### 5.1 创建场景集

1. 进入 **场景集列表** 页面，点击 **新增**
2. 填写名称和描述
3. 从已创建的场景中选择要添加的场景
4. 设置标签和状态

### 5.2 批量执行

场景集执行会按顺序执行所有添加的场景：

- 所有场景共用水环境配置
- 每个场景独立记录执行结果
- 任何一个场景失败不影响其他场景的执行
- 支持跳过失败场景继续执行后续场景

### 5.3 执行报告

场景集执行完成后生成报告，包含：

| 指标 | 说明 |
|------|------|
| total_count | 总场景数 |
| passed_count | 通过数 |
| failed_count | 失败数 |
| skipped_count | 跳过数 |
| total_duration_ms | 总耗时 |

每个场景作为一项独立记录，可点击查看该场景的详细执行日志。

---

## 6. 执行与日志

### 6.1 执行流程

```
1. 加载环境变量
2. 执行开始节点（scenario_start）
3. 按顺序执行每个节点：
   a. node_start：节点开始
   b. 执行 API 调用（使用变量替换）
   c. 执行节点级提取规则
   d. 执行节点级断言规则
   e. node_end：节点结束，记录结果
4. 条件节点：根据条件表达式决定下一个节点
5. 执行结束节点（scenario_end）
6. 返回执行结果
```

### 6.2 状态码说明

| 状态 | 说明 |
|------|------|
| success | 所有节点执行成功，所有断言通过 |
| failed | 有节点执行成功但断言失败 |
| error | 有节点执行出错（网络错误/超时/节点未找到） |
| skipped | 条件分支跳过 |

### 6.3 日志保留策略

- 默认保留最近 100 条执行记录
- 每条记录包含所有步骤详情
- 场景集中的每个场景单独记录执行链接

---

## 附录 A：错误排查

| 问题 | 可能原因 |
|------|---------|
| 节点未找到 | API 节点关联的用例已被删除 |
| 变量未替换 | 变量名拼写错误，或前序节点未提取该变量 |
| 条件表达式错误 | 变量类型不匹配（字符串 vs 数字） |
| 场景集执行失败 | 某场景执行出错，可查看该场景的详细日志 |
| 循环依赖 | 条件分支形成死循环，执行达到最大深度后自动终止 |

---

## 附录 B：相关文件

| 文件 | 说明 |
|------|------|
| `src/server/routes/scenarios.ts` | 场景路由 |
| `src/server/routes/scenario-sets.ts` | 场景集路由 |
| `src/server/db/scenarios.ts` | 场景数据库操作 |
| `src/server/db/scenario-sets.ts` | 场景集数据库操作 |
| `src/server/engine/executor.ts` | 场景执行引擎 |
| `src/server/engine/batch-executor.ts` | 批量执行引擎 |
| `src/client/pages/scenario/ScenarioList.tsx` | 场景列表页 |
| `src/client/pages/scenario/ScenarioDetail.tsx` | 场景详情页（节点编辑器） |
| `src/client/pages/scenario-set/ScenarioSetList.tsx` | 场景集列表页 |
| `src/client/pages/scenario-set/ScenarioSetDetail.tsx` | 场景集详情页 |
| `src/client/pages/scenario/ExecutionResultPanel.tsx` | 执行结果面板 |
| `src/client/components/ScenarioExecutionTimeline.tsx` | 场景执行时间线组件 |