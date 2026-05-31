# 执行与日志系统重构总结

## 一、三层执行架构

| 层级 | 执行入口 | 依赖关系 |
|------|----------|----------|
| API 执行 | `executeApi()` | 无（最底层）|
| 场景执行 | `executeScenario()` | 调用 `executeApi()` |
| 场景集执行 | `runBatch()` | 调用 `executeScenario()` |

---

## 二、数据库表结构

### 2.1 API 执行层

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `api_executions` | 每次 API 调用的会话记录 | `api_id`, `status`, `request_headers`, `request_body`, `response_headers`, `response_body`, `duration_ms`, `param_row_index`, `started_at`, `finished_at` |
| `api_execution_steps` | 步骤级日志 | `api_execution_id`, `step_order`, `log_type`, `step_name`, `log_text`, `log_data` |

**log_type 取值**: `start` | `pre_action` | `main_action` | `post_action` | `final_check` | `error` | `end`

### 2.2 场景执行层

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `scenario_executions` | 每次场景执行的会话记录 | `scenario_id`, `status`, `duration_ms`, `started_at`, `finished_at` |
| `scenario_execution_steps` | 步骤级日志 | `scenario_execution_id`, `step_order`, `log_type`, `node_id`, `node_type`, `log_text`, `log_data` |
| `scenario_api_execution_links` | 关联 API 执行 | `scenario_execution_id`, `node_id`, `param_row_index`, `api_execution_id` |

**log_type 取值**: `scenario_start` | `node_start` | `node_end` | `condition` | `error` | `scenario_end`

### 2.3 场景集执行层

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `scenario_set_executions` | 每次场景集执行的会话记录 | `set_id`, `status`, `total_count`, `passed_count`, `failed_count`, `skipped_count`, `total_duration_ms`, `started_at`, `finished_at` |
| `scenario_set_execution_items` | 场景集中的每个场景条目 | `set_execution_id`, `scenario_id`, `scenario_name`, `status`, `scenario_execution_id` |

---

## 三、日志查询路径

| 页面 | 查询端点 | 返回数据 |
|------|----------|----------|
| API 详情 → 执行记录 | `GET /api/apis/:id/executions` | `api_executions` 列表 |
| API 详情 → 执行详情（展开） | `GET /api/apis/:id/executions/:execId` | `api_executions` + `api_execution_steps` |
| 场景详情 → 执行记录 | `GET /api/scenarios/:id/executions` | `scenario_executions` 列表 |
| 场景详情 → 执行详情（展开） | `GET /api/scenarios/:id/executions/:execId` | `scenario_executions` + `scenario_execution_steps` + `scenario_api_execution_links` |
| 场景集详情 → 执行记录 | `GET /api/scenario-sets/:id/executions` | `scenario_set_executions` + `scenario_set_execution_items` |

---

## 四、旧表（已废弃）

| 表名 | 状态 | 说明 |
|------|------|------|
| `api_logs` | 废弃 | 原来存储 API 执行日志，字段为 JSON 字符串，现已被 `api_executions` + `api_execution_steps` 替代 |
| `scenario_logs` | 废弃 | 原来存储场景执行日志，`node_results` 为 JSON 字符串，现已被 `scenario_executions` + `scenario_execution_steps` 替代 |
| `batch_reports` | 废弃 | 原来存储场景集执行报告，现已被 `scenario_set_executions` + `scenario_set_execution_items` 替代 |

---

## 五、步骤日志示例

### API 步骤日志
```
[1] start        → 开始执行API: 登录
[2] pre_action   → 执行前置动作 / 前置脚本
[3] main_action  → POST https://api.example.com/login 响应: 200 (328ms)
[4] main_action  → 主体断言: 2 通过, 0 失败
[5] post_action  → 执行后置动作 / 后置脚本
[6] final_check  → 执行最终检查: 1 条规则
[7] end          → 执行成功
```

### 场景步骤日志
```
[1] scenario_start → 开始执行场景: 用户登录流程
[2] node_start     → 开始节点: 开始
[3] node_end       → 完成节点: 开始 (1ms)
[4] node_start     → 开始节点: 登录API
[5] node_end       → 完成节点: 登录API 状态码:200 (328ms)
[6] condition      → 评估条件: status_code == 200 → TRUE
[7] scenario_end   → 执行完成 - 状态: success (512ms)
```

---

## 六、关键修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/server/engine/api-executor.ts` | 重写，步骤级日志写入新表 |
| `src/server/engine/executor.ts` | 重写，场景执行步骤日志 |
| `src/server/engine/batch-executor.ts` | 重写，场景集执行记录写入新表 |
| `src/server/db/apis.ts` | 新增 `createApiExecution`, `createApiExecutionStep`, `findApiExecutionsByApiId`, `findApiExecutionWithSteps` |
| `src/server/db/scenarios.ts` | 新增 `createScenarioExecution`, `createScenarioExecutionStep`, `linkScenarioApiExecution`, `findScenarioExecutionsByScenarioId` |
| `src/server/db/batch-reports.ts` | 新增场景集执行相关函数 |
| `src/server/routes/apis.ts` | `POST /execute` 改为调用 `executeApi()`，`GET /logs` 改为查新表 |
| `src/server/routes/scenarios.ts` | `GET /logs` 改为查新表，新增 `/executions` 端点 |
| `src/server/routes/scenario-sets.ts` | 新增 `/executions` 端点 |
| `src/client/types/index.ts` | 新增 `ApiExecution`, `ApiExecutionStep`, `ScenarioExecution`, `ScenarioExecutionStep`, `ScenarioApiExecutionLink`, `ScenarioSetExecution` |
| `src/client/components/ApiExecutionTimeline.tsx` | 新建，API 执行时间线展示 |
| `src/client/components/ScenarioExecutionTimeline.tsx` | 新建，场景执行时间线展示 |
| `src/client/pages/api-test/ApiDetail.tsx` | 集成时间线展示 |
| `src/client/pages/scenario/ScenarioDetail.tsx` | 集成时间线展示 |
| `src/client/pages/scenario-set/ScenarioSetDetail.tsx` | 集成执行详情展示 |