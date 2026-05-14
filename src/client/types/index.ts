export interface UserInfo {
  userId: number;
  account: string;
  nickname?: string;
  avatar?: string;
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
  executed_at: string;
}
