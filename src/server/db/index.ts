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
if (!apiCols.some((col) => col.name === 'test_type')) {
  db.exec("ALTER TABLE apis ADD COLUMN test_type TEXT DEFAULT 'api'");
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
    { name: 'test_type', sql: 'TEXT' },
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
    test_type TEXT DEFAULT 'api',
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
if (!setCols.some(c => c.name === 'test_type')) {
  db.exec("ALTER TABLE scenario_sets ADD COLUMN test_type TEXT DEFAULT 'api'");
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
