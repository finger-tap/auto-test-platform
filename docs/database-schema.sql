-- ============================================================================
-- OpenAutoTest — 完整数据库建表 SQL (SQLite)
-- 导出时间: 2026-06-24
-- 数据库文件: data/app.db
-- 模式: WAL journal, SQLite 3.x
-- ============================================================================
-- 此文件为最终 schema 快照，已合并所有历史 ALTER TABLE 迁移。
-- 新环境直接执行即可建好完整表结构。
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. 用户系统
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'email',
  nickname TEXT,
  avatar TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_users_account ON users(account);

CREATE TABLE IF NOT EXISTS user_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS pending_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pending_items_user ON pending_items(user_id);

-- ============================================================================
-- 2. API 测试
-- ============================================================================

CREATE TABLE IF NOT EXISTS apis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'https',
  headers TEXT,
  body TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  tags TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  content_type TEXT DEFAULT 'json',
  assertions TEXT,
  created_by TEXT,
  updated_by TEXT,
  pre_script TEXT,
  post_script TEXT,
  pre_db_name TEXT,
  pre_db_query TEXT,
  post_db_name TEXT,
  post_db_query TEXT,
  ws_send TEXT,
  ws_expect TEXT,
  pre_actions TEXT DEFAULT '[]',
  post_actions TEXT DEFAULT '[]',
  pre_assertions TEXT,
  post_assertions TEXT,
  final_assertions TEXT,
  parameters TEXT,
  ssl_cert_name TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_apis_user_id ON apis(user_id);

CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_id INTEGER NOT NULL,
  status_code INTEGER,
  response_headers TEXT,
  response_body TEXT,
  duration_ms INTEGER,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  executed_by TEXT,
  assertion_results TEXT,
  request_headers TEXT,
  request_body TEXT,
  FOREIGN KEY (api_id) REFERENCES apis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_logs_api_id ON api_logs(api_id);

CREATE TABLE IF NOT EXISTS api_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_id INTEGER NOT NULL,
  scenario_log_id INTEGER,
  scenario_id INTEGER,
  node_id TEXT,
  param_row_index INTEGER NOT NULL DEFAULT -1,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  request_headers TEXT,
  request_body TEXT,
  response_headers TEXT,
  response_body TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  batch_id INTEGER NOT NULL DEFAULT -1,
  FOREIGN KEY (api_id) REFERENCES apis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_executions_api_id ON api_executions(api_id);
CREATE INDEX IF NOT EXISTS idx_api_executions_batch_id ON api_executions(batch_id);

CREATE TABLE IF NOT EXISTS api_execution_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_execution_id INTEGER NOT NULL,
  step_order INTEGER NOT NULL,
  log_type TEXT NOT NULL,
  step_name TEXT,
  log_text TEXT,
  log_data TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (api_execution_id) REFERENCES api_executions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_execution_steps_api_exec_id ON api_execution_steps(api_execution_id);

-- ============================================================================
-- 3. 场景编排 (API 端)
-- ============================================================================

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT DEFAULT '',
  parameters TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_scenarios_user_id ON scenarios(user_id);

CREATE TABLE IF NOT EXISTS scenario_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  type TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  label TEXT,
  config TEXT,
  pre_script TEXT,
  post_script TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE(scenario_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_scenario_nodes_scenario_id ON scenario_nodes(scenario_id);

CREATE TABLE IF NOT EXISTS scenario_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  edge_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  source_handle TEXT,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE(scenario_id, edge_id)
);
CREATE INDEX IF NOT EXISTS idx_scenario_edges_scenario_id ON scenario_edges(scenario_id);

CREATE TABLE IF NOT EXISTS scenario_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  node_results TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_logs_scenario_id ON scenario_logs(scenario_id);

CREATE TABLE IF NOT EXISTS scenario_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  batch_id INTEGER NOT NULL DEFAULT -1,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_executions_scenario_id ON scenario_executions(scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenario_executions_batch_id ON scenario_executions(batch_id);

CREATE TABLE IF NOT EXISTS scenario_execution_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_execution_id INTEGER NOT NULL,
  step_order INTEGER NOT NULL,
  log_type TEXT NOT NULL,
  node_id TEXT,
  node_type TEXT,
  log_text TEXT,
  log_data TEXT,
  param_row_index INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (scenario_execution_id) REFERENCES scenario_executions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_execution_steps_exec_id ON scenario_execution_steps(scenario_execution_id);

CREATE TABLE IF NOT EXISTS scenario_api_execution_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_execution_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  param_row_index INTEGER,
  api_execution_id INTEGER NOT NULL,
  api_id INTEGER,
  FOREIGN KEY (scenario_execution_id) REFERENCES scenario_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (api_execution_id) REFERENCES api_executions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_api_execution_links_exec_id ON scenario_api_execution_links(scenario_execution_id);

CREATE TABLE IF NOT EXISTS scenario_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scenario_ids TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  created_by TEXT,
  updated_by TEXT,
  tags TEXT DEFAULT '',
  status TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_scenario_sets_user_id ON scenario_sets(user_id);

CREATE TABLE IF NOT EXISTS scenario_set_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  FOREIGN KEY (set_id) REFERENCES scenario_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_set_executions_set_id ON scenario_set_executions(set_id);

CREATE TABLE IF NOT EXISTS scenario_set_execution_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_execution_id INTEGER NOT NULL,
  scenario_id INTEGER NOT NULL,
  scenario_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER,
  error_message TEXT,
  scenario_execution_id INTEGER,
  FOREIGN KEY (set_execution_id) REFERENCES scenario_set_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenario_set_execution_items_exec_id ON scenario_set_execution_items(set_execution_id);

-- ============================================================================
-- 4. Web 测试
-- ============================================================================

CREATE TABLE IF NOT EXISTS web_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  steps TEXT,
  check_points TEXT,
  data_drive TEXT,
  preconditions TEXT,
  browser TEXT DEFAULT 'chromium',
  window_size TEXT DEFAULT '1920x1080',
  timeout INTEGER DEFAULT 30000,
  headless_mode INTEGER DEFAULT 0,
  base_url TEXT,
  case_content TEXT,
  case_content_type TEXT DEFAULT 'text',
  driver_path TEXT,
  close_browser_after_execution INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS web_case_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  executed_by TEXT,
  report_path TEXT,
  report_type TEXT DEFAULT 'midscene',
  error_message TEXT,
  device_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_id) REFERENCES web_test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_web_case_executions_case_id ON web_case_executions(case_id);
CREATE INDEX IF NOT EXISTS idx_web_case_executions_user_id ON web_case_executions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_case_executions_running_per_device
  ON web_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS web_case_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  executed_by TEXT,
  result TEXT,
  error_message TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_id) REFERENCES web_test_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_web_case_logs_case_id ON web_case_logs(case_id);

-- ============================================================================
-- 5. PC 测试
-- ============================================================================

CREATE TABLE IF NOT EXISTS pc_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  steps TEXT,
  check_points TEXT,
  data_drive TEXT,
  preconditions TEXT,
  window_size TEXT DEFAULT '1920x1080',
  timeout INTEGER DEFAULT 30000,
  case_content TEXT,
  case_content_type TEXT DEFAULT 'text',
  driver_path TEXT,
  close_browser_after_execution INTEGER DEFAULT 0,
  display_id TEXT,
  keyboard_driver TEXT,
  xvfb_resolution TEXT,
  headless INTEGER DEFAULT 0,
  platform TEXT DEFAULT 'windows',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pc_case_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  executed_by TEXT,
  report_path TEXT,
  report_type TEXT DEFAULT 'midscene',
  error_message TEXT,
  device_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_id) REFERENCES pc_test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pc_case_executions_case_id ON pc_case_executions(case_id);
CREATE INDEX IF NOT EXISTS idx_pc_case_executions_user_id ON pc_case_executions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_case_executions_running_per_device
  ON pc_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pc_case_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  executed_by TEXT,
  result TEXT,
  error_message TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_id) REFERENCES pc_test_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pc_case_logs_case_id ON pc_case_logs(case_id);

-- ============================================================================
-- 6. 移动端测试
-- ============================================================================

CREATE TABLE IF NOT EXISTS mobile_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT DEFAULT 'android',
  device_name TEXT,
  platform_version TEXT,
  app_package TEXT,
  app_activity TEXT,
  bundle_id TEXT,
  appium_url TEXT DEFAULT 'http://localhost:4723',
  capabilities TEXT,
  test_script TEXT,
  assertions TEXT,
  preconditions TEXT,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  case_content TEXT,
  case_content_type TEXT DEFAULT 'text',
  app_id INTEGER,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mobile_case_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  executed_by TEXT,
  device_id INTEGER,
  local_device_key TEXT DEFAULT NULL,
  report_path TEXT,
  report_type TEXT DEFAULT 'midscene',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_id) REFERENCES mobile_test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_mobile_case_executions_case_id ON mobile_case_executions(case_id);
CREATE INDEX IF NOT EXISTS idx_mobile_case_executions_user_id ON mobile_case_executions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_case_executions_running_per_device
  ON mobile_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_case_executions_running_per_local_device
  ON mobile_case_executions(local_device_key) WHERE status = 'running' AND local_device_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_test_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_case_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  executed_by TEXT,
  result TEXT,
  error_message TEXT,
  screenshots TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (test_case_id) REFERENCES mobile_test_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mobile_test_logs_case_id ON mobile_test_logs(test_case_id);

CREATE TABLE IF NOT EXISTS mobile_case_execution_preview (
  case_execution_id INTEGER PRIMARY KEY,
  preview_kind TEXT NOT NULL,
  session_id TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  total_frames INTEGER NOT NULL DEFAULT 0,
  last_frame_at TEXT,
  FOREIGN KEY (case_execution_id) REFERENCES mobile_case_executions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mobile_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  package_name TEXT,
  versions TEXT NOT NULL DEFAULT '[]',
  latest_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- 7. 设备管理
-- ============================================================================

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  test_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  serial TEXT,
  host TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_heartbeat TEXT,
  metadata TEXT DEFAULT '{}',
  agent_token TEXT,
  agent_endpoint TEXT,
  agent_version TEXT,
  last_seen_at TEXT,
  ssh_host TEXT,
  ssh_port INTEGER DEFAULT 22,
  ssh_user TEXT,
  ssh_auth_type TEXT,
  ssh_password TEXT,
  ssh_private_key TEXT,
  os_type TEXT DEFAULT 'linux',
  needs_upgrade INTEGER DEFAULT 0,
  last_push_at TEXT,
  last_push_status TEXT,
  last_push_error TEXT,
  preview_kind TEXT,
  last_rich_info_at TEXT,
  ssh_tunnel_port INTEGER,
  mobile_agent_port INTEGER DEFAULT 4002,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_test_type ON devices(test_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_agent_token ON devices(agent_token);

-- ============================================================================
-- 8. 用例集 + 调度 (Web/PC/Mobile 共用模板)
-- ============================================================================

-- API 端 batch_reports
CREATE TABLE IF NOT EXISTS batch_reports_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  report TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  executed_by TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (set_id) REFERENCES scenario_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_reports_api_set_id ON batch_reports_api(set_id);

-- API 端 mock
CREATE TABLE IF NOT EXISTS mock_endpoints_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '*',
  path_pattern TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT,
  response_status INTEGER DEFAULT 200,
  response_headers TEXT DEFAULT '{"Content-Type":"application/json"}',
  response_body TEXT DEFAULT '{}',
  response_delay_ms INTEGER DEFAULT 0,
  conditions TEXT DEFAULT '[]',
  match_mode TEXT NOT NULL DEFAULT 'exact',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mock_endpoints_api_user_id ON mock_endpoints_api(user_id);

-- API 端调度
CREATE TABLE IF NOT EXISTS schedule_sets_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_set_id INTEGER NOT NULL,
  cron_expr TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (scenario_set_id) REFERENCES scenario_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_api_ssid ON schedule_sets_api(scenario_set_id);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_api_status ON schedule_sets_api(status, next_run_at);

-- Web/PC/Mobile 用例集 + 执行 + 调度 (循环生成)
-- 以下表结构对 web/pc/mobile 三种类型各生成一份，表名带后缀 _web/_pc/_mobile

-- === case_sets_{type} ===
-- CREATE TABLE IF NOT EXISTS case_sets_web  (同结构, FOREIGN KEY → users)
-- CREATE TABLE IF NOT EXISTS case_sets_pc   (同结构)
-- CREATE TABLE IF NOT EXISTS case_sets_mobile (同结构)

-- === case_set_executions_{type} ===
-- CREATE TABLE IF NOT EXISTS case_set_executions_web  (同结构, FK → case_sets_web)
-- CREATE TABLE IF NOT EXISTS case_set_executions_pc   (同结构)
-- CREATE TABLE IF NOT EXISTS case_set_executions_mobile (同结构)

-- === case_set_execution_items_{type} ===
-- CREATE TABLE IF NOT EXISTS case_set_execution_items_web  (同结构, FK → case_set_executions_web)
-- CREATE TABLE IF NOT EXISTS case_set_execution_items_pc   (同结构)
-- CREATE TABLE IF NOT EXISTS case_set_execution_items_mobile (同结构)

-- === schedule_sets_{type} ===
-- web/pc/mobile 用 case_set_id FK; api 用 scenario_set_id FK (已上面建好)

-- === mock_endpoints_{type} ===
-- === batch_reports_{type} ===

-- 下面用 SQL 生成 3 种类型的完整表:
-- (SQLite 不支持 DO 块，以下手动展开)

-- ── Web ──

CREATE TABLE IF NOT EXISTS case_sets_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  test_case_ids TEXT DEFAULT '[]',
  tags TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_case_sets_web_user_id ON case_sets_web(user_id);

CREATE TABLE IF NOT EXISTS case_set_executions_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (set_id) REFERENCES case_sets_web(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_executions_web_set_id ON case_set_executions_web(set_id);

CREATE TABLE IF NOT EXISTS case_set_execution_items_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_execution_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  case_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER,
  error_message TEXT,
  case_execution_id INTEGER,
  report_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (set_execution_id) REFERENCES case_set_executions_web(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_execution_items_web_set_exec_id ON case_set_execution_items_web(set_execution_id);

CREATE TABLE IF NOT EXISTS schedule_sets_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_set_id INTEGER NOT NULL,
  cron_expr TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_set_id) REFERENCES case_sets_web(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_web_case_set_id ON schedule_sets_web(case_set_id);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_web_status ON schedule_sets_web(status, next_run_at);

CREATE TABLE IF NOT EXISTS mock_endpoints_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '*',
  path_pattern TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT,
  response_status INTEGER DEFAULT 200,
  response_headers TEXT DEFAULT '{"Content-Type":"application/json"}',
  response_body TEXT DEFAULT '{}',
  response_delay_ms INTEGER DEFAULT 0,
  conditions TEXT DEFAULT '[]',
  match_mode TEXT NOT NULL DEFAULT 'exact',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mock_endpoints_web_user_id ON mock_endpoints_web(user_id);

CREATE TABLE IF NOT EXISTS batch_reports_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  report TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  executed_by TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (set_id) REFERENCES case_sets_web(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_reports_web_set_id ON batch_reports_web(set_id);

-- ── PC ──

CREATE TABLE IF NOT EXISTS case_sets_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  test_case_ids TEXT DEFAULT '[]',
  tags TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_case_sets_pc_user_id ON case_sets_pc(user_id);

CREATE TABLE IF NOT EXISTS case_set_executions_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (set_id) REFERENCES case_sets_pc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_executions_pc_set_id ON case_set_executions_pc(set_id);

CREATE TABLE IF NOT EXISTS case_set_execution_items_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_execution_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  case_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER,
  error_message TEXT,
  case_execution_id INTEGER,
  report_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (set_execution_id) REFERENCES case_set_executions_pc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_execution_items_pc_set_exec_id ON case_set_execution_items_pc(set_execution_id);

CREATE TABLE IF NOT EXISTS schedule_sets_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_set_id INTEGER NOT NULL,
  cron_expr TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_set_id) REFERENCES case_sets_pc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_pc_case_set_id ON schedule_sets_pc(case_set_id);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_pc_status ON schedule_sets_pc(status, next_run_at);

CREATE TABLE IF NOT EXISTS mock_endpoints_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '*',
  path_pattern TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT,
  response_status INTEGER DEFAULT 200,
  response_headers TEXT DEFAULT '{"Content-Type":"application/json"}',
  response_body TEXT DEFAULT '{}',
  response_delay_ms INTEGER DEFAULT 0,
  conditions TEXT DEFAULT '[]',
  match_mode TEXT NOT NULL DEFAULT 'exact',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mock_endpoints_pc_user_id ON mock_endpoints_pc(user_id);

CREATE TABLE IF NOT EXISTS batch_reports_pc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  report TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  executed_by TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (set_id) REFERENCES case_sets_pc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_reports_pc_set_id ON batch_reports_pc(set_id);

-- ── Mobile ──

CREATE TABLE IF NOT EXISTS case_sets_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  test_case_ids TEXT DEFAULT '[]',
  tags TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_case_sets_mobile_user_id ON case_sets_mobile(user_id);

CREATE TABLE IF NOT EXISTS case_set_executions_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  executed_by TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (set_id) REFERENCES case_sets_mobile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_executions_mobile_set_id ON case_set_executions_mobile(set_id);

CREATE TABLE IF NOT EXISTS case_set_execution_items_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_execution_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  case_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER,
  error_message TEXT,
  case_execution_id INTEGER,
  report_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (set_execution_id) REFERENCES case_set_executions_mobile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_set_execution_items_mobile_set_exec_id ON case_set_execution_items_mobile(set_execution_id);

CREATE TABLE IF NOT EXISTS schedule_sets_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_set_id INTEGER NOT NULL,
  cron_expr TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (case_set_id) REFERENCES case_sets_mobile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_mobile_case_set_id ON schedule_sets_mobile(case_set_id);
CREATE INDEX IF NOT EXISTS idx_schedule_sets_mobile_status ON schedule_sets_mobile(status, next_run_at);

CREATE TABLE IF NOT EXISTS mock_endpoints_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '*',
  path_pattern TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  status TEXT,
  response_status INTEGER DEFAULT 200,
  response_headers TEXT DEFAULT '{"Content-Type":"application/json"}',
  response_body TEXT DEFAULT '{}',
  response_delay_ms INTEGER DEFAULT 0,
  conditions TEXT DEFAULT '[]',
  match_mode TEXT NOT NULL DEFAULT 'exact',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mock_endpoints_mobile_user_id ON mock_endpoints_mobile(user_id);

CREATE TABLE IF NOT EXISTS batch_reports_mobile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  report TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  executed_by TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (set_id) REFERENCES case_sets_mobile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_reports_mobile_set_id ON batch_reports_mobile(set_id);

-- ============================================================================
-- 9. 环境管理
-- ============================================================================

CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  ssl_cert TEXT,
  ssl_key TEXT,
  ssl_certs TEXT DEFAULT '[]',
  timeout INTEGER DEFAULT 30000,
  sort_order INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  databases TEXT DEFAULT '[]',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_environments_user_id ON environments(user_id);

-- ============================================================================
-- 10. Midscene 模型配置
-- ============================================================================

CREATE TABLE IF NOT EXISTS midscene_config (
  user_id INTEGER PRIMARY KEY,
  model_name TEXT,
  model_api_key TEXT,
  model_base_url TEXT,
  model_family TEXT,
  model_timeout INTEGER,
  model_temperature REAL,
  model_retry_count INTEGER,
  model_retry_interval INTEGER,
  model_http_proxy TEXT,
  model_socks_proxy TEXT,
  model_extra_body_json TEXT,
  model_init_config_json TEXT,
  model_reasoning_enabled INTEGER,
  model_reasoning_effort TEXT,
  model_reasoning_budget INTEGER,
  insight_model_name TEXT,
  insight_model_api_key TEXT,
  insight_model_base_url TEXT,
  insight_model_family TEXT,
  insight_model_timeout INTEGER,
  insight_model_temperature REAL,
  insight_model_retry_count INTEGER,
  insight_model_retry_interval INTEGER,
  insight_model_http_proxy TEXT,
  insight_model_socks_proxy TEXT,
  insight_model_extra_body_json TEXT,
  insight_model_init_config_json TEXT,
  insight_model_reasoning_enabled INTEGER,
  insight_model_reasoning_effort TEXT,
  insight_model_reasoning_budget INTEGER,
  planning_model_name TEXT,
  planning_model_api_key TEXT,
  planning_model_base_url TEXT,
  planning_model_family TEXT,
  planning_model_timeout INTEGER,
  planning_model_temperature REAL,
  planning_model_retry_count INTEGER,
  planning_model_retry_interval INTEGER,
  planning_model_http_proxy TEXT,
  planning_model_socks_proxy TEXT,
  planning_model_extra_body_json TEXT,
  planning_model_init_config_json TEXT,
  planning_model_reasoning_enabled INTEGER,
  planning_model_reasoning_effort TEXT,
  planning_model_reasoning_budget INTEGER,
  preferred_language TEXT,
  replanning_cycle_limit INTEGER,
  wait_after_action INTEGER,
  screenshot_shrink_factor INTEGER,
  report_storage_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- 11. Web 浏览器配置
-- ============================================================================

CREATE TABLE IF NOT EXISTS web_browser_config (
  user_id INTEGER PRIMARY KEY,
  driver_path TEXT,
  user_data_dir TEXT,
  accept_downloads INTEGER NOT NULL DEFAULT 0,
  download_dir TEXT,
  auto_download INTEGER NOT NULL DEFAULT 0,
  executable_path TEXT,
  chromium_sandbox INTEGER NOT NULL DEFAULT 0,
  close_browser_after_execution INTEGER NOT NULL DEFAULT 0,
  keep_context_alive INTEGER NOT NULL DEFAULT 0,
  default_timeout_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- 用户偏好（按测试类型存储环境选择等）
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  test_type TEXT NOT NULL,          -- 'api' | 'web' | 'pc' | 'mobile'
  environment_id INTEGER,           -- NULL = 未选择
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(user_id, test_type)
);

-- ============================================================================
-- 表清单汇总 (共 46 张表)
-- ============================================================================
-- users, user_tags, pending_items, user_preferences
-- apis, api_logs, api_executions, api_execution_steps
-- scenarios, scenario_nodes, scenario_edges, scenario_logs
-- scenario_executions, scenario_execution_steps, scenario_api_execution_links
-- scenario_sets, scenario_set_executions, scenario_set_execution_items
-- web_test_cases, web_case_executions, web_case_logs
-- pc_test_cases, pc_case_executions, pc_case_logs
-- mobile_test_cases, mobile_case_executions, mobile_test_logs
-- mobile_case_execution_preview, mobile_apps
-- devices
-- environments, midscene_config, web_browser_config
-- case_sets_{web,pc,mobile}, case_set_executions_{web,pc,mobile}
-- case_set_execution_items_{web,pc,mobile}
-- schedule_sets_{api,web,pc,mobile}
-- mock_endpoints_{api,web,pc,mobile}
-- batch_reports_{api,web,pc,mobile}
-- ============================================================================
