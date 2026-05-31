# 执行日志表设计文档

## 概述

执行日志系统分为三个独立的日志链，分别对应 API执行、场景执行、场景集执行。三条日志链独立完整，通过关联表实现交叉引用。

---

## 日志表层级关系

```
L0 业务数据层 (apis, scenarios, scenario_sets)
    │
    ├─── L1 执行记录主表
    │    ├── api_executions          # API执行记录
    │    ├── scenario_executions     # 场景执行记录
    │    └── scenario_set_executions  # 场景集执行记录
    │
    └─── L2 步骤/明细表
         ├── api_execution_steps          # API执行步骤明细 (属于 api_executions)
         ├── scenario_execution_steps     # 场景执行步骤明细 (属于 scenario_executions)
         ├── scenario_api_execution_links  # 场景-API执行关联 (连接 scenario_executions ↔ api_executions)
         └── scenario_set_execution_items  # 场景集执行项目明细 (属于 scenario_set_executions)
```

---

## 表结构详情

### L1 执行记录主表

#### 1. api_executions（API执行记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| api_id | INTEGER FK | 关联 apis 表 |
| scenario_log_id | INTEGER FK | 可选，关联旧版 scenario_logs |
| scenario_id | INTEGER FK | 可选，关联 scenarios 表 |
| node_id | TEXT | 可选，场景中的节点ID |
| param_row_index | INTEGER | 参数化行索引，-1表示非参数化 |
| status | TEXT | running/success/failed/error |
| trigger_type | TEXT | manual/scheduled 等 |
| executed_by | TEXT | 执行人 |
| request_headers | TEXT | 请求头 JSON |
| request_body | TEXT | 请求体 |
| response_headers | TEXT | 响应头 JSON |
| response_body | TEXT | 响应体 |
| duration_ms | INTEGER | 执行耗时 |
| error_message | TEXT | 错误信息 |
| started_at | TEXT | ISO时间 |
| finished_at | TEXT | ISO时间 |

#### 2. scenario_executions（场景执行记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| scenario_id | INTEGER FK | 关联 scenarios 表 |
| status | TEXT | running/success/failed/error |
| trigger_type | TEXT | manual/scheduled 等 |
| executed_by | TEXT | 执行人 |
| duration_ms | INTEGER | 执行耗时 |
| error_message | TEXT | 错误信息 |
| started_at | TEXT | ISO时间 |
| finished_at | TEXT | ISO时间 |

#### 3. scenario_set_executions（场景集执行记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| set_id | INTEGER FK | 关联 scenario_sets 表 |
| status | TEXT | running/success/partial/failed |
| trigger_type | TEXT | manual/scheduled 等 |
| executed_by | TEXT | 执行人 |
| total_count | INTEGER | 场景总数 |
| passed_count | INTEGER | 通过数 |
| failed_count | INTEGER | 失败数 |
| skipped_count | INTEGER | 跳过数 |
| total_duration_ms | INTEGER | 总耗时 |
| started_at | TEXT | ISO时间 |
| finished_at | TEXT | ISO时间 |

---

### L2 步骤/明细表

#### 4. api_execution_steps（API执行步骤明细）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| api_execution_id | INTEGER FK | 关联 api_executions |
| step_order | INTEGER | 步骤序号 |
| log_type | TEXT | start/pre_action/main_action/post_action/final_check/error/end |
| step_name | TEXT | 步骤名称 |
| log_text | TEXT | 步骤描述 |
| log_data | TEXT | 步骤详细数据(JSON) |
| created_at | TEXT | ISO时间 |

**log_type 枚举值：**
- `start` - 开始执行
- `pre_action` - 前置动作（脚本/数据库/断言）
- `main_action` - 主体请求+响应+断言
- `post_action` - 后置动作
- `final_check` - 最终检查
- `error` - 错误
- `end` - 执行完成

#### 5. scenario_execution_steps（场景执行步骤明细）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| scenario_execution_id | INTEGER FK | 关联 scenario_executions |
| step_order | INTEGER | 步骤序号 |
| log_type | TEXT | scenario_start/node_start/node_end/condition/pre_action/post_action/scenario_end |
| node_id | TEXT | 节点ID |
| node_type | TEXT | 节点类型 start/api/condition/end |
| log_text | TEXT | 步骤描述 |
| log_data | TEXT | 步骤详细数据(JSON) |
| created_at | TEXT | ISO时间 |

**log_type 枚举值：**
- `scenario_start` - 场景开始
- `node_start` - 节点开始
- `node_end` - 节点完成
- `condition` - 条件评估
- `pre_action` - 前置脚本错误
- `post_action` - 后置脚本错误
- `scenario_end` - 场景完成

#### 6. scenario_api_execution_links（场景-API执行关联表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| scenario_execution_id | INTEGER FK | 关联 scenario_executions |
| node_id | TEXT | 场景中的API节点ID |
| param_row_index | INTEGER | 参数化行索引，可为null |
| api_execution_id | INTEGER FK | 关联 api_executions |

**用途：** 实现场景与API执行的多对多关联
- 一个场景节点执行N次API（参数化场景，每行参数产生一个api_execution）
- 一个API执行可能被多个场景引用（复用场景时）

#### 7. scenario_set_execution_items（场景集执行项目明细）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| set_execution_id | INTEGER FK | 关联 scenario_set_executions |
| scenario_id | INTEGER | 场景ID |
| scenario_name | TEXT | 场景名称(冗余存储) |
| status | TEXT | success/failed/skipped |
| duration_ms | INTEGER | 执行耗时 |
| error_message | TEXT | 错误信息 |
| scenario_execution_id | INTEGER FK | 关联 scenario_executions(可选) |

---

## 表间关联关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           场景集执行链 (Batch)                               │
│                                                                             │
│  scenario_sets ──────► scenario_set_executions                              │
│        │                     │                                              │
│        │              scenario_set_execution_items                           │
│        │                     │                                              │
│        │              scenario_executions ◄──── scenario_api_execution_links │
│        │                     │                      │                       │
│        │                     │              api_executions                  │
│        │                     │                      │                       │
│        │                     │              api_execution_steps              │
│        │                     │                                              │
│        ▼                     ▼                                              │
│  scenarios ─────────► scenario_executions ──────► scenario_execution_steps │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 日志链详解

### API执行日志链 (api-executor)

```
api_execution (L1)
    │
    └── api_execution_steps (L2)
         ├── start           开始执行
         ├── pre_action      前置动作(脚本/数据库查询/前置断言)
         ├── main_action     主体请求 + 主体断言
         ├── post_action     后置动作(脚本/数据库查询/后置断言)
         ├── final_check     最终检查(最终断言)
         └── end             执行完成
```

### 场景执行日志链 (executor)

```
scenario_execution (L1)
    │
    └── scenario_execution_steps (L2)
         ├── scenario_start      场景开始
         ├── node_start          节点开始(start/api/condition/end)
         ├── [node actions]      节点执行(pre_action/post_action)
         ├── node_end            节点完成
         ├── condition           条件评估(仅condition节点)
         └── scenario_end        场景完成
```

### 场景集执行日志链 (batch-executor)

```
scenario_set_execution (L1)
    │
    └── scenario_set_execution_items (L2)
         ├── scenario_id         场景ID
         ├── status              执行状态
         ├── duration_ms         执行耗时
         ├── scenario_execution_id ──► scenario_execution (可选)
```

---

## 关键设计决策

1. **独立日志链**：三条日志链完全独立，通过外键关联业务表，不相互依赖
2. **JSON存储log_data**：步骤详情以JSON字符串存储，支持灵活扩展
3. **关联表设计**：scenario_api_execution_links 实现场景与API执行的多对多关系
4. **时间戳记录**：started_at/finished_at 双时间戳，便于性能分析和问题追踪
5. **参数化支持**：param_row_index 支持参数化场景，每行参数产生独立的执行记录

---

## 数据库表清单

| 层级 | 表名 | 用途 |
|------|------|------|
| L1 | api_executions | API执行主记录 |
| L2 | api_execution_steps | API执行步骤明细 |
| L1 | scenario_executions | 场景执行主记录 |
| L2 | scenario_execution_steps | 场景执行步骤明细 |
| L2 | scenario_api_execution_links | 场景-API执行关联 |
| L1 | scenario_set_executions | 场景集执行主记录 |
| L2 | scenario_set_execution_items | 场景集执行项目明细 |

共计：**7张日志表**