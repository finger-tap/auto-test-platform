import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const db = new Database(dbPath);
type Database = InstanceType<typeof Database>;

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'email',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_account ON users(account);
`);

// Migration: add account_type column for existing databases
const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!columns.some((col) => col.name === 'account_type')) {
  db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'email'");
}
if (!columns.some((col) => col.name === 'nickname')) {
  db.exec("ALTER TABLE users ADD COLUMN nickname TEXT");
}
if (!columns.some((col) => col.name === 'avatar')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
}
if (!columns.some((col) => col.name === 'email')) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}
if (!columns.some((col) => col.name === 'phone')) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
}

// Ensure avatar upload directory exists
const avatarDir = path.join(dataDir, 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  );
`);
db.exec(`
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
    FOREIGN KEY (api_id) REFERENCES apis(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_api_logs_api_id ON api_logs(api_id);
`);

// Migration: add tags/status columns to apis table
const apiCols = db.prepare("PRAGMA table_info(apis)").all() as { name: string }[];
if (!apiCols.some((col) => col.name === 'tags')) {
  db.exec("ALTER TABLE apis ADD COLUMN tags TEXT DEFAULT ''");
}
if (!apiCols.some((col) => col.name === 'status')) {
  db.exec("ALTER TABLE apis ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}
if (!apiCols.some((col) => col.name === 'content_type')) {
  db.exec("ALTER TABLE apis ADD COLUMN content_type TEXT DEFAULT 'json'");
}
if (!apiCols.some((col) => col.name === 'assertions')) {
  db.exec("ALTER TABLE apis ADD COLUMN assertions TEXT");
}
if (!apiCols.some((col) => col.name === 'pre_script')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_script TEXT");
}
if (!apiCols.some((col) => col.name === 'post_script')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_script TEXT");
}
if (!apiCols.some((col) => col.name === 'pre_db_name')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_db_name TEXT");
}
if (!apiCols.some((col) => col.name === 'pre_db_query')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_db_query TEXT");
}
if (!apiCols.some((col) => col.name === 'post_db_name')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_db_name TEXT");
}
if (!apiCols.some((col) => col.name === 'post_db_query')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_db_query TEXT");
}
if (!apiCols.some((col) => col.name === 'pre_assertions')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_assertions TEXT");
}
if (!apiCols.some((col) => col.name === 'post_assertions')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_assertions TEXT");
}
if (!apiCols.some((col) => col.name === 'final_assertions')) {
  db.exec("ALTER TABLE apis ADD COLUMN final_assertions TEXT");
}
if (!apiCols.some((col) => col.name === 'ws_send')) {
  db.exec("ALTER TABLE apis ADD COLUMN ws_send TEXT");
}
if (!apiCols.some((col) => col.name === 'ws_expect')) {
  db.exec("ALTER TABLE apis ADD COLUMN ws_expect TEXT");
}
if (!apiCols.some((col) => col.name === 'pre_actions')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_actions TEXT DEFAULT '[]'");
}
if (!apiCols.some((col) => col.name === 'post_actions')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_actions TEXT DEFAULT '[]'");
}
if (!apiCols.some((col) => col.name === 'parameters')) {
  db.exec("ALTER TABLE apis ADD COLUMN parameters TEXT");
}

// Migration: add maintainer fields to relevant tables
const tableMigrations: { table: string; columns: { name: string; sql: string }[] }[] = [
  { table: 'apis', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'scenarios', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
    { name: 'parameters', sql: 'TEXT' },
  ]},
  { table: 'scenario_sets', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'environments', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'schedules', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints_api', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints_web', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints_pc', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints_mobile', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
];

try {
  for (const mig of tableMigrations) {
    const cols = db.prepare(`PRAGMA table_info(${mig.table})`).all() as { name: string }[];
    for (const col of mig.columns) {
      if (!cols.some(c => c.name === col.name)) {
        db.exec(`ALTER TABLE ${mig.table} ADD COLUMN ${col.name} TEXT`);
      }
    }
  }
} catch {
  // Some tables don't exist yet - skip migration
}

// Migration: migrate single DB fields to multi-database JSON array
try {
  const dbEnvCols = db.prepare("PRAGMA table_info(environments)").all() as { name: string }[];
  const hasOldDbFields = dbEnvCols.some(c => c.name === 'db_host');
  const hasDatabasesField = dbEnvCols.some(c => c.name === 'databases');

  if (hasOldDbFields && !hasDatabasesField) {
    // Migrate existing single DB config to new JSON format
    const oldEnvs = db.prepare("SELECT * FROM environments WHERE db_host IS NOT NULL AND db_host != ''").all() as Array<{
      id: number; db_type: string; db_host: string; db_port: number; db_user: string; db_password: string; db_name: string;
    }>;
    for (const env of oldEnvs) {
      const databases = [{
        name: '默认数据库',
        type: env.db_type || 'mysql',
        host: env.db_host || '',
        port: env.db_port || (env.db_type === 'mysql' ? 3306 : 5432),
        user: env.db_user || '',
        password: env.db_password || '',
        database: env.db_name || '',
      }];
      db.prepare("UPDATE environments SET databases = ? WHERE id = ?").run(JSON.stringify(databases), env.id);
    }
    console.log('[DB Migration] Migrated environments DB config to multi-database format');
  }

  if (!hasDatabasesField) {
    db.exec("ALTER TABLE environments ADD COLUMN databases TEXT DEFAULT '[]'");
  }
} catch {
  // environments table doesn't exist yet
}

const apiCols2 = db.prepare("PRAGMA table_info(apis)").all() as { name: string }[];
if (!apiCols2.some((col) => col.name === 'pre_script')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_script TEXT");
}
if (!apiCols2.some((col) => col.name === 'post_script')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_script TEXT");
}

// Pre/post script database selection fields
if (!apiCols2.some((col) => col.name === 'pre_db_name')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_db_name TEXT");
}
if (!apiCols2.some((col) => col.name === 'pre_db_query')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_db_query TEXT");
}
if (!apiCols2.some((col) => col.name === 'post_db_name')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_db_name TEXT");
}
if (!apiCols2.some((col) => col.name === 'post_db_query')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_db_query TEXT");
}

// Migration: add executed_by to api_logs
const logCols = db.prepare("PRAGMA table_info(api_logs)").all() as { name: string }[];
if (!logCols.some((col) => col.name === 'executed_by')) {
  db.exec("ALTER TABLE api_logs ADD COLUMN executed_by TEXT");
}
if (!logCols.some((col) => col.name === 'assertion_results')) {
  db.exec("ALTER TABLE api_logs ADD COLUMN assertion_results TEXT");
}
if (!logCols.some((col) => col.name === 'request_headers')) {
  db.exec("ALTER TABLE api_logs ADD COLUMN request_headers TEXT");
}
if (!logCols.some((col) => col.name === 'request_body')) {
  db.exec("ALTER TABLE api_logs ADD COLUMN request_body TEXT");
}

// Migration: add ws_send / ws_expect to apis
const apiCols3 = db.prepare("PRAGMA table_info(apis)").all() as { name: string }[];
if (!apiCols3.some((col) => col.name === 'ws_send')) {
  db.exec("ALTER TABLE apis ADD COLUMN ws_send TEXT");
}
if (!apiCols3.some((col) => col.name === 'ws_expect')) {
  db.exec("ALTER TABLE apis ADD COLUMN ws_expect TEXT");
}
// Migration: add pre_actions / post_actions (new JSON format for componentized pre/post actions)
const apiCols4 = db.prepare("PRAGMA table_info(apis)").all() as { name: string }[];
if (!apiCols4.some((col) => col.name === 'pre_actions')) {
  db.exec("ALTER TABLE apis ADD COLUMN pre_actions TEXT DEFAULT '[]'");
}
if (!apiCols4.some((col) => col.name === 'post_actions')) {
  db.exec("ALTER TABLE apis ADD COLUMN post_actions TEXT DEFAULT '[]'");
}

// ── Scenario tables ──
db.exec(`
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
`);

// ── API Execution tables ──
db.exec(`
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
`);

// ── Scenario Execution tables ──
db.exec(`
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
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS environments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    ssl_cert TEXT,
    ssl_key TEXT,
    timeout INTEGER DEFAULT 30000,
    sort_order INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_environments_user_id ON environments(user_id);

  CREATE TABLE IF NOT EXISTS scenario_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    scenario_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_scenario_sets_user_id ON scenario_sets(user_id);

  CREATE TABLE IF NOT EXISTS batch_reports (
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

  CREATE INDEX IF NOT EXISTS idx_batch_reports_set_id ON batch_reports(set_id);
`);

// ── Mock endpoints table ──
db.exec(`
  CREATE TABLE IF NOT EXISTS mock_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '*',
    path_pattern TEXT NOT NULL,
    description TEXT,
    response_status INTEGER DEFAULT 200,
    response_headers TEXT DEFAULT '{"Content-Type":"application/json"}',
    response_body TEXT DEFAULT '{}',
    response_delay_ms INTEGER DEFAULT 0,
    conditions TEXT DEFAULT '[]',
    match_mode TEXT NOT NULL DEFAULT 'exact',
    enabled INTEGER NOT NULL DEFAULT 1,
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_hit_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_mock_endpoints_user_id ON mock_endpoints(user_id);
`);

// ── Web test cases table ──
db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── PC test cases table ──
db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── Mobile test cases table ──
db.exec(`
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
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

export default db;

// Migration: add pre/post script columns to scenario_nodes
const nodeCols = db.prepare("PRAGMA table_info(scenario_nodes)").all() as { name: string }[];
const nodeColNames = nodeCols.map(c => c.name);
if (!nodeColNames.includes('pre_script')) {
  db.exec("ALTER TABLE scenario_nodes ADD COLUMN pre_script TEXT");
}
if (!nodeColNames.includes('post_script')) {
  db.exec("ALTER TABLE scenario_nodes ADD COLUMN post_script TEXT");
}

const linkCols = db.prepare("PRAGMA table_info(scenario_api_execution_links)").all() as { name: string }[];
if (!linkCols.some(c => c.name === 'api_id')) {
  db.exec("ALTER TABLE scenario_api_execution_links ADD COLUMN api_id INTEGER");
}

// Migration: tags column for scenarios and scenario_sets
const scenarioCols = db.prepare("PRAGMA table_info(scenarios)").all() as { name: string }[];
if (!scenarioCols.some(c => c.name === 'tags')) {
  db.exec("ALTER TABLE scenarios ADD COLUMN tags TEXT DEFAULT ''");
}
const setCols = db.prepare("PRAGMA table_info(scenario_sets)").all() as { name: string }[];
if (!setCols.some(c => c.name === 'tags')) {
  db.exec("ALTER TABLE scenario_sets ADD COLUMN tags TEXT DEFAULT ''");
}

// Migration: create user_tags table for existing databases
const tagTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tags'").get();
if (!tagTableExists) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  )`);
}

// ── Test type isolation: 拆分 mock_endpoints / batch_reports 为 4 张独立表 ──
const MOCK_TABLE_TYPES = ['api', 'web', 'pc', 'mobile'] as const;
for (const t of MOCK_TABLE_TYPES) {
  const tableName = `mock_endpoints_${t}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
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
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_${tableName}_user_id ON ${tableName}(user_id);
  `);
}

for (const t of MOCK_TABLE_TYPES) {
  const tableName = `batch_reports_${t}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER NOT NULL,
      report TEXT NOT NULL,
      passed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      executed_by TEXT,
      executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (set_id) REFERENCES scenario_sets_${t}(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_${tableName}_set_id ON ${tableName}(set_id);
  `);
}

// ── 补齐 5 张隔离场景/场景集表的 CREATE TABLE ──
for (const t of MOCK_TABLE_TYPES) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenarios_${t} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT DEFAULT '',
      parameters TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scenarios_${t}_user_id ON scenarios_${t}(user_id);

    CREATE TABLE IF NOT EXISTS scenario_nodes_${t} (
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
      FOREIGN KEY (scenario_id) REFERENCES scenarios_${t}(id) ON DELETE CASCADE,
      UNIQUE(scenario_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_nodes_${t}_scenario_id ON scenario_nodes_${t}(scenario_id);

    CREATE TABLE IF NOT EXISTS scenario_edges_${t} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      edge_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      source_handle TEXT,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (scenario_id) REFERENCES scenarios_${t}(id) ON DELETE CASCADE,
      UNIQUE(scenario_id, edge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_edges_${t}_scenario_id ON scenario_edges_${t}(scenario_id);

    CREATE TABLE IF NOT EXISTS scenario_logs_${t} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      executed_by TEXT,
      node_results TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      executed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (scenario_id) REFERENCES scenarios_${t}(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_logs_${t}_scenario_id ON scenario_logs_${t}(scenario_id);

    CREATE TABLE IF NOT EXISTS scenario_sets_${t} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      scenario_ids TEXT DEFAULT '[]',
      tags TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_sets_${t}_user_id ON scenario_sets_${t}(user_id);
  `);
}

// ── 表重建工具函数（保留 PK/NOT NULL/DEFAULT 约束）──
type ColInfo = { name: string; type: string; pk: number; notnull: number; dflt_value: unknown };

function buildColumnDefinitions(cols: ColInfo[]): string {
  return cols.map(c => {
    let def = `${c.name} ${c.type}`;
    if (c.pk > 0) def += ' PRIMARY KEY AUTOINCREMENT';
    if (c.notnull) def += ' NOT NULL';
    if (c.dflt_value !== null) {
      const dv = String(c.dflt_value);
      // PRAGMA 返回函数调用表达式时会剥掉外层括号（如 datetime('now', '+8 hours')），
      // 需要用括号包裹以保持原 schema 中的 DEFAULT (datetime(...)) 形式
      if (!dv.startsWith('(') && dv.includes('(')) {
        def += ` DEFAULT (${dv})`;
      } else {
        def += ` DEFAULT ${dv}`;
      }
    }
    return def;
  }).join(', ');
}

function dropOrphanTempTables(name: string, prefix: string): void {
  const orphans = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`
  ).all(`${name}_${prefix}%`) as { name: string }[];
  if (orphans.length > 0) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      for (const o of orphans) db.exec(`DROP TABLE IF EXISTS ${o.name}`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── 移除 test_type 列（一次性迁移，幂等）──
function recreateTableWithoutTestType(name: string): void {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all() as ColInfo[];
  if (!cols.find(c => c.name === 'test_type')) return;
  dropOrphanTempTables(name, 'tt_removal');
  const keep = cols.filter(c => c.name !== 'test_type');
  const colDefs = buildColumnDefinitions(keep);
  const colNames = keep.map(c => c.name).join(', ');
  const tmpName = `${name}_tt_removal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`CREATE TABLE ${tmpName} (${colDefs})`);
    db.exec(`INSERT INTO ${tmpName} (${colNames}) SELECT ${colNames} FROM ${name}`);
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${tmpName} RENAME TO ${name}`);
    console.log(`[DB Migration] Removed test_type column from ${name}`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

['apis', 'scenarios', 'scenario_sets', 'web_test_cases', 'pc_test_cases', 'mobile_test_cases'].forEach(recreateTableWithoutTestType);

// ── 恢复约束（一次性，幂等）──
// 早期 recreateTableWithoutTestType 错误地丢失了 PRIMARY KEY/NOT NULL/DEFAULT 约束，
// 导致 child 表（api_executions / scenario_executions / 等）引用 parent.id 时报
// "foreign key mismatch" 错误。本函数用硬编码的完整 schema 重建 6 张 parent 表以恢复约束。
// 注:不能用 PRAGMA table_info 反推(id 已是 pk=0,反推会得到无 PK 的新表)
const RESTORE_SCHEMAS: Record<string, string> = {
  apis: `CREATE TABLE apis (
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
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  scenarios: `CREATE TABLE scenarios (
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
  )`,
  scenario_sets: `CREATE TABLE scenario_sets (
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
  )`,
  web_test_cases: `CREATE TABLE web_test_cases (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  pc_test_cases: `CREATE TABLE pc_test_cases (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  mobile_test_cases: `CREATE TABLE mobile_test_cases (
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
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
};

function restoreTableConstraints(name: string): void {
  const schema = RESTORE_SCHEMAS[name];
  if (!schema) return;
  const cols = db.prepare(`PRAGMA table_info(${name})`).all() as ColInfo[];
  if (cols.some(c => c.pk > 0)) return;  // 已有 PK,跳过
  dropOrphanTempTables(name, 'restore');
  const colNames = cols.map(c => c.name).join(', ');
  const tmpName = `${name}_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpSchema = schema.replace(new RegExp(`CREATE TABLE ${name}\\b`), `CREATE TABLE ${tmpName}`);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(tmpSchema);
    db.exec(`INSERT INTO ${tmpName} (${colNames}) SELECT ${colNames} FROM ${name}`);
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${tmpName} RENAME TO ${name}`);
    console.log(`[DB Migration] Restored constraints on ${name}`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

['apis', 'scenarios', 'scenario_sets', 'web_test_cases', 'pc_test_cases', 'mobile_test_cases'].forEach(restoreTableConstraints);

// batch_reports 已无代码引用,test_type 列单独移除(表有 0 行数据,直接 DROP)
const batchReportHasTestType = (db.prepare("PRAGMA table_info(batch_reports)").all() as { name: string }[]).some(c => c.name === 'test_type');
if (batchReportHasTestType) {
  db.exec('DROP TABLE batch_reports');
  console.log('[DB Migration] Dropped legacy batch_reports table (split into 4 per-type tables)');
}

// 旧的 mock_endpoints 表(0 行数据,只在新表都不存在时保留兼容)
const mockEndpointsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mock_endpoints'").get();
if (mockEndpointsExists) {
  db.exec('DROP TABLE mock_endpoints');
  console.log('[DB Migration] Dropped legacy mock_endpoints table (split into 4 per-type tables)');
}
