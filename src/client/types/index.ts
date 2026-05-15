export interface UserInfo {
  userId: number;
  account: string;
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
  created_at: string;
  updated_at: string;
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
  assertion_results: AssertionResult[] | null;
  executed_at: string;
}

export interface AssertionRule {
  name?: string;
  source: 'status' | 'header' | 'body';
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

// ── Scenario Types ──

export interface Scenario {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
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
}

// Node config types (stored as JSON in config field)
export interface ApiNodeConfig {
  api_id: number;
  api_name?: string;
  extract_rules: ExtractRule[];
  assertions?: AssertionRule[];
  override_headers?: string;
  override_body?: string;
}

export interface ConditionNodeConfig {
  condition_expr: string;
}

export interface ExtractRule {
  var_name: string;
  source: 'status' | 'header' | 'body';
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
}
