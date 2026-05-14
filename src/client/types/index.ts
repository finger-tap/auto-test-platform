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
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  assertion_results: AssertionResult[] | null;
  executed_at: string;
}

export interface AssertionRule {
  source: 'status' | 'header' | 'body';
  key: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'exists' | 'not_exists';
  expected: string;
}

export interface AssertionResult {
  rule: AssertionRule;
  passed: boolean;
  actual: string;
}
