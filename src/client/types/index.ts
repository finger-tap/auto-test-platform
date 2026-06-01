export interface EnvVariable {
  key: string;
  value: string;
  description?: string;
  enabled?: boolean;
}

export interface Environment {
  id: number;
  user_id: number;
  name: string;
  variables: EnvVariable[];
  ssl_cert: string | null;
  ssl_key: string | null;
  timeout: number;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  // Multiple databases
  databases?: string; // JSON array of DatabaseEntry
}

export interface DatabaseEntry {
  name: string;
  type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface UserInfo {
  userId: number;
  account: string;
  account_type?: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
}

export interface LoginResponse {
  token: string;
  user: UserInfo;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export interface ApiItem {
  id: number;
  user_id: number;
  name: string;
  method: string;
  url: string;
  protocol: string;
  headers: string | null;
  body: string | null;
  description: string | null;
  tags: string | null;
  status: string;
  content_type: string | null;
  assertions: string | null;
  pre_script?: string;
  post_script?: string;
  pre_db_name?: string;
  pre_db_query?: string;
  post_db_name?: string;
  post_db_query?: string;
  pre_assertions?: string;
  post_assertions?: string;
  final_assertions?: string;
  pre_actions?: string;   // JSON array of PrePostAction[]
  post_actions?: string; // JSON array of PrePostAction[]
  parameters?: string | null;  // JSON: ParametersConfig
  ws_messages?: string | null;
  ws_wait_ms?: number | null;
  ws_auto_close_ms?: number | null;
  created_at: string;
  updated_at: string;
}

// 参数化配置
export interface ParametersConfig {
  enabled: boolean;
  source: 'csv' | 'manual';
  headers: string[];      // 列头，即变量名
  rows: string[][];       // 数据行
}

export interface ApiLog {
  id: number;
  api_id: number;
  status_code: number | null;
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: AssertionResult[] | AssertionResultsByStage | null;
  executed_at: string;
  param_summary?: {
    total_rows: number;
    enabled_rows: number;
    results?: {
      row: number;
      status: number | null;
      duration_ms: number;
      passed: number;
      failed: number;
      error?: string;
    }[];
  };
}

export interface AssertionRule {
  name?: string;
  source: 'status' | 'header' | 'body' | 'vars' | 'result' | 'row_count';
  key: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;
  assert?: boolean;
}

export interface AssertionResult {
  rule: AssertionRule;
  passed: boolean;
  actual: string;
}

// New multi-stage assertion results
export interface AssertionResultsByStage {
  main?: AssertionResult[];
  pre?: AssertionResult[];
  post?: AssertionResult[];
  final?: AssertionResult[];
}

// ── Scenario Types ──

export interface Scenario {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
  parameters: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioNode {
  id: number;
  scenario_id: number;
  node_id: string;
  type: 'start' | 'api' | 'condition' | 'end';
  position_x: number;
  position_y: number;
  label: string | null;
  config: string | null;
}

export interface ScenarioEdge {
  id: number;
  scenario_id: number;
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  label: string | null;
}

export interface ScenarioLog {
  id: number;
  scenario_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  node_results: string | null;
  duration_ms: number | null;
  error_message: string | null;
  executed_at: string;
  param_summary?: {
    total_rows: number;
    row_indices: number[];
    headers: string[];
  };
}

// Node config types (stored as JSON in config field)
export interface ApiNodeConfig {
  node_id?: string;
  api_id: number;
  api_name?: string;
  // 提取变量（独立数组）
  extractions?: ExtractRule[];
  // 断言（独立数组）
  assertions?: AssertionRule[];
  // 可选：合并模式兼容旧数据（同时有 extract_rules 和 assertions 时优先用新字段）
  extract_rules?: ExtractRule[];
  override_headers?: string;
  override_body?: string;
  // 前后置脚本
  pre_script?: string;
  post_script?: string;
}

export interface ConditionNodeConfig {
  condition_expr: string;
}

export interface ExtractRule {
  var_name: string;
  source: 'status' | 'header' | 'body' | 'vars' | 'result' | 'row_count';
  key: string;
}

// Execution result per node
export interface NodeExecutionResult {
  node_id: string;
  node_type: string;
  node_name?: string;
  status: 'success' | 'failed' | 'skipped' | 'error';
  api_id?: number;
  status_code?: number;
  request_headers?: string;
  request_body?: string;
  response_headers?: string;
  response_body?: string;
  duration_ms?: number;
  extract_values?: Record<string, string>;
  assertion_results?: AssertionResult[];
  condition_result?: boolean;
  error_message?: string;
  /** 参数化行索引（场景级参数化时有效），如 0, 1, 2... */
  param_row_index?: number;
  /** 执行过程日志：提取和断言的每一步记录 */
  logs?: Array<{ type: 'extract' | 'assert'; source: string; key: string; operator?: string; expected?: string; actual: string; passed: boolean; node_name?: string }>;
}

// ── OpenAPI Import/Export Types ──
export interface ParsedApi {
  name: string;
  method: string;
  url: string;
  description: string;
  tags: string[];
  headers: Record<string, string>;
  body: string;
  content_type: string;
}

export interface ParseResult {
  format: 'openapi3' | 'swagger2' | 'postman' | 'unknown';
  title: string;
  version: string;
  baseUrl: string;
  apis: ParsedApi[];
}

// ── Mobile Test Types ──

export interface MobileTestCase {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  platform: string;
  device_name: string | null;
  platform_version: string | null;
  app_package: string | null;
  app_activity: string | null;
  bundle_id: string | null;
  appium_url: string | null;
  capabilities: string | null;
  test_script: string | null;
  assertions: string | null;
  tags: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MobileTestLog {
  id: number;
  test_case_id: number;
  status: string;
  duration_ms: number | null;
  executed_by: string | null;
  result: string | null;
  error_message: string | null;
  screenshots: string | null;
  executed_at: string;
}

export interface MobileTestStep {
  action: 'launch' | 'tap' | 'input' | 'swipe' | 'assert' | 'screenshot' | 'back' | 'home' | 'sleep' | 'scroll';
  target?: string;
  value?: string;
  duration?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
}

// ── New Execution Types ──

export interface ApiExecutionStep {
  id: number;
  api_execution_id: number;
  step_order: number;
  log_type: 'start' | 'pre_action' | 'main_action' | 'post_action' | 'final_check' | 'error' | 'end';
  step_name: string | null;
  log_text: string | null;
  log_data: string | null;
  created_at: string;
}

export interface ApiExecution {
  id: number;
  api_id: number;
  scenario_log_id: number | null;
  scenario_id: number | null;
  node_id: string | null;
  param_row_index: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  request_headers: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  batch_id: number;
  steps?: ApiExecutionStep[];
  sub_executions?: ApiExecution[];
}

export interface ScenarioExecutionStep {
  id: number;
  scenario_execution_id: number;
  step_order: number;
  log_type: string;
  node_id: string | null;
  node_type: string | null;
  log_text: string | null;
  log_data: string | null;
  param_row_index: number | null;
  created_at: string;
}

export interface ScenarioApiExecutionLink {
  id: number;
  scenario_execution_id: number;
  node_id: string;
  param_row_index: number | null;
  api_execution_id: number;
  api_id: number | null;
}

export interface ScenarioExecution {
  id: number;
  scenario_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  batch_id: number;
  sub_executions?: ScenarioExecution[];
  steps?: ScenarioExecutionStep[];
  api_links?: ScenarioApiExecutionLink[];
}

export interface ScenarioExecutionStep {
  id: number;
  scenario_execution_id: number;
  step_order: number;
  log_type: string;
  node_id: string | null;
  node_type: string | null;
  log_text: string | null;
  log_data: string | null;
  param_row_index: number | null;
  created_at: string;
}

export interface ScenarioApiExecutionLink {
  id: number;
  scenario_execution_id: number;
  node_id: string;
  param_row_index: number | null;
  api_execution_id: number;
  api_id: number | null;
}

export interface ScenarioSetExecutionItem {
  id: number;
  set_execution_id: number;
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  scenario_execution_id: number | null;
  scenario_execution?: ScenarioExecution;
}

export interface ScenarioSetExecution {
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
