import {
  mysqlTable, int, varchar, text, mediumtext, double,
  index, uniqueIndex,
} from 'drizzle-orm/mysql-core';

/**
 * Team business tables.
 *
 * CRITICAL DESIGN: every column PROPERTY is snake_case and identical to the
 * local SQLite column name. Drizzle select() returns objects keyed by the
 * property name, so rows served to the existing frontend pages have the
 * EXACT shape they get from the local SQLite routes today (web_test_cases
 * rows with user_id/tags/case_content...). Zero frontend page changes.
 *
 * Team adds: team_id / project_id / owner_id / version (optimistic lock).
 * t_ prefix avoids collisions. JSON columns stay text (parsed by frontend).
 *
 * Executions / logs / reports: served as empty lists; /execute → 501 until
 * the center executor lands (dispatcher handles both).
 */

const ts = () => ({
  created_at: varchar('created_at', { length: 32 }).notNull(),
  updated_at: varchar('updated_at', { length: 32 }).notNull(),
});

const scope = () => ({
  team_id: int('team_id').notNull(),
  project_id: int('project_id').notNull(),
  owner_id: int('owner_id').notNull(),
  version: int('version').notNull().default(1),
});

// ── API 测试 ────────────────────────────────────────────────────────────────

export const tApis = mysqlTable('t_apis', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  method: varchar('method', { length: 16 }).notNull().default('GET'),
  url: text('url').notNull(),
  protocol: varchar('protocol', { length: 16 }).notNull().default('https'),
  headers: text('headers'),
  body: mediumtext('body'),
  description: text('description'),
  tags: text('tags'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  content_type: varchar('content_type', { length: 64 }),
  assertions: text('assertions'),
  pre_script: mediumtext('pre_script'),
  post_script: mediumtext('post_script'),
  pre_db_name: varchar('pre_db_name', { length: 128 }),
  pre_db_query: mediumtext('pre_db_query'),
  post_db_name: varchar('post_db_name', { length: 128 }),
  post_db_query: mediumtext('post_db_query'),
  pre_assertions: text('pre_assertions'),
  post_assertions: text('post_assertions'),
  final_assertions: text('final_assertions'),
  ws_send: text('ws_send'),
  ws_expect: text('ws_expect'),
  ssl_cert_name: varchar('ssl_cert_name', { length: 128 }),
  pre_actions: text('pre_actions'),
  post_actions: text('post_actions'),
  parameters: text('parameters'),
  created_by: varchar('created_by', { length: 128 }),
  updated_by: varchar('updated_by', { length: 128 }),
  ...ts(),
}, (t) => [index('idx_t_apis_scope').on(t.team_id, t.project_id)]);

export const tScenarios = mysqlTable('t_scenarios', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  tags: text('tags'),
  parameters: text('parameters'),
  ...ts(),
}, (t) => [index('idx_t_scenarios_scope').on(t.team_id, t.project_id)]);

export const tScenarioNodes = mysqlTable('t_scenario_nodes', {
  id: int('id').autoincrement().primaryKey(),
  scenario_id: int('scenario_id').notNull(),
  node_id: varchar('node_id', { length: 128 }).notNull(),
  type: varchar('type', { length: 64 }).notNull(),
  position_x: double('position_x').notNull().default(0),
  position_y: double('position_y').notNull().default(0),
  label: varchar('label', { length: 255 }),
  config: mediumtext('config'),
  created_at: varchar('created_at', { length: 32 }).notNull(),
  updated_at: varchar('updated_at', { length: 32 }).notNull(),
}, (t) => [
  uniqueIndex('uk_t_scenario_nodes').on(t.scenario_id, t.node_id),
  index('idx_t_scenario_nodes_sid').on(t.scenario_id),
]);

export const tScenarioEdges = mysqlTable('t_scenario_edges', {
  id: int('id').autoincrement().primaryKey(),
  scenario_id: int('scenario_id').notNull(),
  edge_id: varchar('edge_id', { length: 128 }).notNull(),
  source_node_id: varchar('source_node_id', { length: 128 }).notNull(),
  target_node_id: varchar('target_node_id', { length: 128 }).notNull(),
  source_handle: varchar('source_handle', { length: 64 }),
  label: varchar('label', { length: 255 }),
  created_at: varchar('created_at', { length: 32 }).notNull(),
}, (t) => [
  uniqueIndex('uk_t_scenario_edges').on(t.scenario_id, t.edge_id),
  index('idx_t_scenario_edges_sid').on(t.scenario_id),
]);

export const tScenarioSets = mysqlTable('t_scenario_sets', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  scenario_ids: text('scenario_ids').notNull(),
  ...ts(),
}, (t) => [index('idx_t_scenario_sets_scope').on(t.team_id, t.project_id)]);

// ── Web / PC / Mobile 用例 ─────────────────────────────────────────────────

export const tWebCases = mysqlTable('t_web_cases', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  tags: text('tags'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  steps: text('steps'),
  check_points: text('check_points'),
  data_drive: text('data_drive'),
  preconditions: text('preconditions'),
  browser: varchar('browser', { length: 64 }),
  window_size: varchar('window_size', { length: 32 }),
  timeout: int('timeout'),
  headless_mode: int('headless_mode'),
  base_url: text('base_url'),
  case_content: mediumtext('case_content'),
  case_content_type: varchar('case_content_type', { length: 16 }),
  driver_path: text('driver_path'),
  close_browser_after_execution: int('close_browser_after_execution'),
  created_by: varchar('created_by', { length: 128 }),
  updated_by: varchar('updated_by', { length: 128 }),
  ...ts(),
}, (t) => [index('idx_t_web_cases_scope').on(t.team_id, t.project_id)]);

export const tPcCases = mysqlTable('t_pc_cases', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  tags: text('tags'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  steps: text('steps'),
  check_points: text('check_points'),
  data_drive: text('data_drive'),
  preconditions: text('preconditions'),
  window_size: varchar('window_size', { length: 32 }),
  timeout: int('timeout'),
  case_content: mediumtext('case_content'),
  case_content_type: varchar('case_content_type', { length: 16 }),
  driver_path: text('driver_path'),
  display_id: varchar('display_id', { length: 64 }),
  keyboard_driver: varchar('keyboard_driver', { length: 64 }),
  xvfb_resolution: varchar('xvfb_resolution', { length: 32 }),
  headless: int('headless'),
  platform: varchar('platform', { length: 32 }).default('windows'),
  created_by: varchar('created_by', { length: 128 }),
  updated_by: varchar('updated_by', { length: 128 }),
  ...ts(),
}, (t) => [index('idx_t_pc_cases_scope').on(t.team_id, t.project_id)]);

export const tMobileCases = mysqlTable('t_mobile_cases', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  platform: varchar('platform', { length: 32 }).default('android'),
  device_name: varchar('device_name', { length: 255 }),
  platform_version: varchar('platform_version', { length: 32 }),
  app_package: varchar('app_package', { length: 255 }),
  app_activity: varchar('app_activity', { length: 255 }),
  bundle_id: varchar('bundle_id', { length: 255 }),
  appium_url: varchar('appium_url', { length: 255 }).default('http://localhost:4723'),
  capabilities: text('capabilities'),
  test_script: text('test_script'),
  assertions: text('assertions'),
  preconditions: text('preconditions'),
  tags: text('tags'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  case_content: mediumtext('case_content'),
  case_content_type: varchar('case_content_type', { length: 16 }),
  created_by: varchar('created_by', { length: 128 }),
  updated_by: varchar('updated_by', { length: 128 }),
  ...ts(),
}, (t) => [index('idx_t_mobile_cases_scope').on(t.team_id, t.project_id)]);

// ── 用例集 ─────────────────────────────────────────────────────────────────

function caseSetTable(name: string) {
  return mysqlTable(name, {
    id: int('id').autoincrement().primaryKey(),
    ...scope(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    test_case_ids: text('test_case_ids').notNull(),
    tags: text('tags'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    ...ts(),
  }, (t) => [index(`idx_${name}_scope`).on(t.team_id, t.project_id)]);
}
export const tCaseSetsWeb = caseSetTable('t_case_sets_web');
export const tCaseSetsPc = caseSetTable('t_case_sets_pc');
export const tCaseSetsMobile = caseSetTable('t_case_sets_mobile');

// ── 共享资源 ────────────────────────────────────────────────────────────────

export const tEnvironments = mysqlTable('t_environments', {
  id: int('id').autoincrement().primaryKey(),
  ...scope(),
  name: varchar('name', { length: 255 }).notNull(),
  variables: text('variables').notNull(),
  ssl_cert: text('ssl_cert'),
  ssl_key: text('ssl_key'),
  ssl_certs: text('ssl_certs').notNull(),
  timeout: int('timeout').default(30000),
  sort_order: int('sort_order').default(0),
  is_default: int('is_default').default(0),
  ...ts(),
}, (t) => [index('idx_t_environments_scope').on(t.team_id, t.project_id)]);

export const tDevices = mysqlTable('t_devices', {
  id: int('id').autoincrement().primaryKey(),
  team_id: int('team_id').notNull(),
  project_id: int('project_id'),
  owner_id: int('owner_id').notNull(),
  version: int('version').notNull().default(1),
  name: varchar('name', { length: 255 }).notNull(),
  test_type: varchar('test_type', { length: 16 }).notNull(),
  platform: varchar('platform', { length: 32 }).notNull(),
  serial: varchar('serial', { length: 255 }),
  host: varchar('host', { length: 512 }),
  status: varchar('status', { length: 16 }).notNull().default('unknown'),
  last_heartbeat: varchar('last_heartbeat', { length: 32 }),
  metadata: text('metadata'),
  agent_token: varchar('agent_token', { length: 128 }),
  agent_endpoint: varchar('agent_endpoint', { length: 512 }),
  agent_version: varchar('agent_version', { length: 64 }),
  last_seen_at: varchar('last_seen_at', { length: 32 }),
  ssh_host: varchar('ssh_host', { length: 255 }),
  ssh_port: int('ssh_port').default(22),
  ssh_user: varchar('ssh_user', { length: 128 }),
  ssh_auth_type: varchar('ssh_auth_type', { length: 32 }),
  ssh_password: text('ssh_password'),
  ssh_private_key: text('ssh_private_key'),
  os_type: varchar('os_type', { length: 32 }).default('linux'),
  needs_upgrade: int('needs_upgrade').default(0),
  last_push_at: varchar('last_push_at', { length: 32 }),
  last_push_status: varchar('last_push_status', { length: 32 }),
  last_push_error: text('last_push_error'),
  preview_kind: varchar('preview_kind', { length: 32 }),
  ssh_tunnel_port: int('ssh_tunnel_port'),
  mobile_agent_port: int('mobile_agent_port').default(4002),
  ...ts(),
}, (t) => [
  index('idx_t_devices_team').on(t.team_id),
  index('idx_t_devices_test_type').on(t.test_type),
]);

// ── Mock（四类隔离）────────────────────────────────────────────────────────

function mockTable(name: string) {
  return mysqlTable(name, {
    id: int('id').autoincrement().primaryKey(),
    ...scope(),
    name: varchar('name', { length: 255 }).notNull(),
    method: varchar('method', { length: 16 }).notNull().default('*'),
    path_pattern: text('path_pattern').notNull(),
    description: text('description'),
    tags: text('tags'),
    status: varchar('status', { length: 32 }),
    response_status: int('response_status').default(200),
    response_headers: text('response_headers'),
    response_body: mediumtext('response_body'),
    response_delay_ms: int('response_delay_ms').default(0),
    conditions: text('conditions'),
    match_mode: varchar('match_mode', { length: 16 }).notNull().default('exact'),
    enabled: int('enabled').notNull().default(1),
    hit_count: int('hit_count').notNull().default(0),
    last_hit_at: varchar('last_hit_at', { length: 32 }),
    ...ts(),
  }, (t) => [index(`idx_${name}_scope`).on(t.team_id, t.project_id)]);
}
export const tMocksApi = mockTable('t_mocks_api');
export const tMocksWeb = mockTable('t_mocks_web');
export const tMocksPc = mockTable('t_mocks_pc');
export const tMocksMobile = mockTable('t_mocks_mobile');

// ── 调度（行级 CRUD；触发执行后续接入）────────────────────────────────────

function scheduleTable(name: string, fkCol: string) {
  return mysqlTable(name, {
    id: int('id').autoincrement().primaryKey(),
    ...scope(),
    [fkCol]: int(fkCol).notNull(),
    cron_expr: varchar('cron_expr', { length: 128 }),
    status: varchar('status', { length: 16 }).notNull().default('none'),
    next_run_at: varchar('next_run_at', { length: 32 }),
    last_run_at: varchar('last_run_at', { length: 32 }),
    last_run_status: varchar('last_run_status', { length: 32 }),
    ...ts(),
  }, (t) => [index(`idx_${name}_scope`).on(t.team_id, t.project_id)]);
}
export const tScheduleSetsApi = scheduleTable('t_schedule_sets_api', 'scenario_set_id');
export const tScheduleSetsWeb = scheduleTable('t_schedule_sets_web', 'case_set_id');
export const tScheduleSetsPc = scheduleTable('t_schedule_sets_pc', 'case_set_id');
export const tScheduleSetsMobile = scheduleTable('t_schedule_sets_mobile', 'case_set_id');

// ── 团队标签 / 审计 / 通知 ────────────────────────────────────────────────

export const tTags = mysqlTable('t_tags', {
  id: int('id').autoincrement().primaryKey(),
  team_id: int('team_id').notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  color: varchar('color', { length: 32 }).default(''),
  created_at: varchar('created_at', { length: 32 }).notNull(),
}, (t) => [uniqueIndex('uk_t_tags').on(t.team_id, t.name)]);

export const tAuditLogs = mysqlTable('t_audit_logs', {
  id: int('id').autoincrement().primaryKey(),
  team_id: int('team_id').notNull(),
  project_id: int('project_id'),
  user_id: int('user_id').notNull(),
  account: varchar('account', { length: 128 }).notNull(),
  action: varchar('action', { length: 32 }).notNull(),
  resource_type: varchar('resource_type', { length: 64 }).notNull(),
  resource_id: int('resource_id'),
  resource_name: varchar('resource_name', { length: 255 }),
  detail: mediumtext('detail'),
  created_at: varchar('created_at', { length: 32 }).notNull(),
}, (t) => [
  index('idx_t_audit_team').on(t.team_id, t.project_id),
  index('idx_t_audit_resource').on(t.resource_type, t.resource_id),
]);

export const tNotifyChannels = mysqlTable('t_notify_channels', {
  id: int('id').autoincrement().primaryKey(),
  team_id: int('team_id').notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  webhook_url: text('webhook_url').notNull(),
  secret: text('secret'),
  events: text('events').notNull(),
  enabled: int('enabled').notNull().default(1),
  created_by: int('created_by').notNull(),
  ...ts(),
}, (t) => [index('idx_t_notify_team').on(t.team_id)]);
