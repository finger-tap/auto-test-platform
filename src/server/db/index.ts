import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../../data');
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
    { name: 'ssl_cert_name', sql: 'TEXT' },
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
    { name: 'ssl_certs', sql: "TEXT DEFAULT '[]'" },
  ]},
  { table: 'schedules', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'mock_endpoints_api', columns: [
    { name: 'created_by', sql: 'TEXT' },
    { name: 'updated_by', sql: 'TEXT' },
  ]},
  { table: 'web_browser_config', columns: [
    { name: 'keep_context_alive', sql: 'INTEGER' },
  ]},
];

try {
  for (const mig of tableMigrations) {
    const cols = db.prepare(`PRAGMA table_info(${mig.table})`).all() as { name: string }[];
    for (const col of mig.columns) {
      if (!cols.some(c => c.name === col.name)) {
        db.exec(`ALTER TABLE ${mig.table} ADD COLUMN ${col.name} ${col.sql}`);
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

// Migration: move old ssl_cert/ssl_key into ssl_certs JSON array
try {
  const envCols = db.prepare("PRAGMA table_info(environments)").all() as { name: string }[];
  const hasSslCerts = envCols.some(c => c.name === 'ssl_certs');
  const hasOldSslCert = envCols.some(c => c.name === 'ssl_cert');

  if (hasOldSslCert && !hasSslCerts) {
    db.exec("ALTER TABLE environments ADD COLUMN ssl_certs TEXT DEFAULT '[]'");
  }
  // Also migrate when ssl_certs column exists but is empty '[]' while old ssl_cert has data
  if (hasOldSslCert) {
    const oldEnvs = db.prepare(
      "SELECT id, ssl_cert, ssl_key FROM environments WHERE ssl_cert IS NOT NULL AND ssl_cert != '' AND (ssl_certs IS NULL OR ssl_certs = '[]' OR ssl_certs = '')"
    ).all() as Array<{ id: number; ssl_cert: string; ssl_key: string }>;
    for (const env of oldEnvs) {
      const certs = [{ name: '默认证书', cert: env.ssl_cert, key: env.ssl_key || '' }];
      db.prepare("UPDATE environments SET ssl_certs = ? WHERE id = ?").run(JSON.stringify(certs), env.id);
    }
    if (oldEnvs.length > 0) {
      console.log(`[DB Migration] Migrated ${oldEnvs.length} environments SSL certs to ssl_certs JSON format`);
    }
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
    ssl_certs TEXT DEFAULT '[]',
    timeout INTEGER DEFAULT 30000,
    sort_order INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_environments_user_id ON environments(user_id);
`);

// 2026-06-05: per-user Midscene model configuration. One row per user.
// Columns mirror the MIDSCENE_* env vars. The web/pc/mobile executors read
// this row before each case and call Midscene's overrideAIConfig() so the
// next execution picks up the new model without a server restart.
db.exec(`
  CREATE TABLE IF NOT EXISTS midscene_config (
    user_id INTEGER PRIMARY KEY,
    -- Default intent (the only one currently required by Midscene)
    model_name TEXT,
    model_api_key TEXT,
    model_base_url TEXT,
    model_family TEXT,
    model_timeout INTEGER,
    model_temperature REAL,
    -- 2026-06-14: extended per-intent model options (mirror MIDSCENE_*_MODEL_* env)
    model_retry_count INTEGER,
    model_retry_interval INTEGER,
    model_http_proxy TEXT,
    model_socks_proxy TEXT,
    model_extra_body_json TEXT,
    model_init_config_json TEXT,
    model_reasoning_enabled INTEGER,
    model_reasoning_effort TEXT,
    model_reasoning_budget INTEGER,
    -- Insight intent (element localization / assertion)
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
    -- Planning intent (action decomposition)
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
    -- Preferences
    preferred_language TEXT,
    -- 2026-06-14: execution behavior overrides (global, not per-intent).
    -- replanning_cycle_limit maps to MIDSCENE_REPLANNING_CYCLE_LIMIT env AND
    -- AgentOpt.replanningCycleLimit; wait_after_action / screenshot_shrink_factor
    -- map to AgentOpt.waitAfterAction / screenshotShrinkFactor. null = default.
    replanning_cycle_limit INTEGER,
    wait_after_action INTEGER,
    screenshot_shrink_factor INTEGER,
    -- 2026-06-06: per-user Midscene report storage path. null = use the
    -- default REPORTS_ROOT (data/midscene-reports). Absolute path on disk.
    -- Read by src/server/engine/report-paths.ts:generateReportPath() and
    -- src/server/index.ts:serveMidsceneReport() to dynamically resolve the
    -- filesystem location of /midscene-reports/* URLs.
    report_storage_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Idempotent migration for already-existing midscene_config tables that
// pre-date the report_storage_path column. CREATE TABLE IF NOT EXISTS
// does NOT add new columns to an existing table, so we add it here.
// The PRAGMA + ALTER pattern matches the rest of this file.
const mscCols = db.prepare("PRAGMA table_info(midscene_config)").all() as { name: string }[];
if (!mscCols.some((col) => col.name === 'report_storage_path')) {
  db.exec("ALTER TABLE midscene_config ADD COLUMN report_storage_path TEXT");
  console.log('[DB Migration] Added midscene_config.report_storage_path column');
}
// 2026-06-14: extended per-intent + execution-behavior columns. Idempotent:
// each guard checks PRAGMA before ALTER so re-runs on fresh DBs (where CREATE
// TABLE already has the columns) are a no-op.
const mscAddCol = (name: string, type: string) => {
  if (!mscCols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE midscene_config ADD COLUMN ${name} ${type}`);
  }
};
// Per-intent extension (default prefix empty)
mscAddCol('model_retry_count', 'INTEGER');
mscAddCol('model_retry_interval', 'INTEGER');
mscAddCol('model_http_proxy', 'TEXT');
mscAddCol('model_socks_proxy', 'TEXT');
mscAddCol('model_extra_body_json', 'TEXT');
mscAddCol('model_init_config_json', 'TEXT');
mscAddCol('model_reasoning_enabled', 'INTEGER');
mscAddCol('model_reasoning_effort', 'TEXT');
mscAddCol('model_reasoning_budget', 'INTEGER');
// Per-intent extension (insight)
mscAddCol('insight_model_retry_count', 'INTEGER');
mscAddCol('insight_model_retry_interval', 'INTEGER');
mscAddCol('insight_model_http_proxy', 'TEXT');
mscAddCol('insight_model_socks_proxy', 'TEXT');
mscAddCol('insight_model_extra_body_json', 'TEXT');
mscAddCol('insight_model_init_config_json', 'TEXT');
mscAddCol('insight_model_reasoning_enabled', 'INTEGER');
mscAddCol('insight_model_reasoning_effort', 'TEXT');
mscAddCol('insight_model_reasoning_budget', 'INTEGER');
// Per-intent extension (planning)
mscAddCol('planning_model_retry_count', 'INTEGER');
mscAddCol('planning_model_retry_interval', 'INTEGER');
mscAddCol('planning_model_http_proxy', 'TEXT');
mscAddCol('planning_model_socks_proxy', 'TEXT');
mscAddCol('planning_model_extra_body_json', 'TEXT');
mscAddCol('planning_model_init_config_json', 'TEXT');
mscAddCol('planning_model_reasoning_enabled', 'INTEGER');
mscAddCol('planning_model_reasoning_effort', 'TEXT');
mscAddCol('planning_model_reasoning_budget', 'INTEGER');
// Execution behavior (global)
mscAddCol('replanning_cycle_limit', 'INTEGER');
mscAddCol('wait_after_action', 'INTEGER');
mscAddCol('screenshot_shrink_factor', 'INTEGER');

db.exec(`
  -- Per-user Web browser configuration. Replaces the per-case driver_path /
  -- close_browser_after_execution columns on web_test_cases, plus adds
  -- previously-unimplemented Playwright launch options (userDataDir /
  -- acceptDownloads / downloadsPath / autoDownload / executablePath /
  -- chromiumSandbox / defaultTimeoutMs). The web executor resolves the
  -- user's row at case-start and merges into the launch options.
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
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
    driver_path TEXT,
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
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
    driver_path TEXT,
    -- 2026-06-14: ComputerAgent (native desktop) options. Replace the old
    -- Playwright browser fields. These map directly to ComputerDeviceOpt.
    display_id TEXT,
    keyboard_driver TEXT,
    xvfb_resolution TEXT,
    headless INTEGER DEFAULT 0,
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
    preconditions TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_by TEXT,
    updated_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Phase 4: add preconditions column to mobile_test_cases for parity with web/pc
try {
  db.exec("ALTER TABLE mobile_test_cases ADD COLUMN preconditions TEXT");
} catch (e) {
  // Column already exists — ignore.
}

// 2026-06-05: 浏览器复用 + 关闭配置。close_browser_after_execution=1 表示本 case
// 跑完后销毁共享 Browser;0(默认)表示保留 Browser 给后续 case 复用,避免每次
// 重新 launch。
try { db.exec("ALTER TABLE web_test_cases ADD COLUMN close_browser_after_execution INTEGER DEFAULT 0"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE pc_test_cases ADD COLUMN close_browser_after_execution INTEGER DEFAULT 0"); } catch (e) { /* exists */ }

// Phase 8 (2026-06-04): add case_content + case_content_type columns to
// web/pc/mobile case tables. The new "用例内容" tab stores its body as raw
// text (→ Midscene aiAct) or YAML (→ Midscene runYaml). Pre-existing `steps`
// (web/pc) and `test_script` (mobile) columns are kept for backward compat —
// the executor falls back to them when `case_content` is empty.
const caseContentAlter: Array<{ table: string; col: string; ddl: string }> = [
  { table: 'web_test_cases', col: 'case_content', ddl: 'ALTER TABLE web_test_cases ADD COLUMN case_content TEXT' },
  { table: 'web_test_cases', col: 'case_content_type', ddl: "ALTER TABLE web_test_cases ADD COLUMN case_content_type TEXT DEFAULT 'text'" },
  { table: 'pc_test_cases', col: 'case_content', ddl: 'ALTER TABLE pc_test_cases ADD COLUMN case_content TEXT' },
  { table: 'pc_test_cases', col: 'case_content_type', ddl: "ALTER TABLE pc_test_cases ADD COLUMN case_content_type TEXT DEFAULT 'text'" },
  { table: 'mobile_test_cases', col: 'case_content', ddl: 'ALTER TABLE mobile_test_cases ADD COLUMN case_content TEXT' },
  { table: 'mobile_test_cases', col: 'case_content_type', ddl: "ALTER TABLE mobile_test_cases ADD COLUMN case_content_type TEXT DEFAULT 'text'" },
];
for (const { ddl } of caseContentAlter) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

// Phase 9 (2026-06-04): per-case `driver_path` override for Playwright
// browser binaries. Empty / NULL = use the project-bundled default at
// <projectRoot>/drivers (set in src/server/index.ts at startup).
const driverPathAlter: Array<{ table: string; ddl: string }> = [
  { table: 'web_test_cases', ddl: 'ALTER TABLE web_test_cases ADD COLUMN driver_path TEXT' },
  { table: 'pc_test_cases', ddl: 'ALTER TABLE pc_test_cases ADD COLUMN driver_path TEXT' },
];
for (const { ddl } of driverPathAlter) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

// 2026-06-14: ComputerAgent native-desktop options. Idempotent ALTERs for
// existing pc_test_cases tables. These replace the old Playwright browser
// config (browser/headless_mode/base_url are unused by ComputerAgent).
const pcDesktopAlter: Array<{ ddl: string }> = [
  { ddl: 'ALTER TABLE pc_test_cases ADD COLUMN display_id TEXT' },
  { ddl: 'ALTER TABLE pc_test_cases ADD COLUMN keyboard_driver TEXT' },
  { ddl: 'ALTER TABLE pc_test_cases ADD COLUMN xvfb_resolution TEXT' },
  { ddl: 'ALTER TABLE pc_test_cases ADD COLUMN headless INTEGER DEFAULT 0' },
];
for (const { ddl } of pcDesktopAlter) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

// 2026-06-16: pc_test_cases.platform — 平台筛选(mac/linux/windows)
try { db.exec("ALTER TABLE pc_test_cases ADD COLUMN platform TEXT DEFAULT 'windows'"); } catch { /* exists */ }

// ── Devices table（Web/PC/Mobile 设备/浏览器统一管理）──
// test_type: 'web' | 'pc' | 'mobile' —— 设备所属测试类型
// platform:  web=chromium/firefox/webkit；pc=win/mac/linux；mobile=android/ios/harmony
// serial: 浏览器实例 id 或设备序列号 / udid
// host: 平台回连地址（如 http://192.168.127.1:3000），agent 用它连接 server
// status: online / offline / unknown —— 由执行器 / 手动刷新 / agent 心跳写入
// 2026-06-06: 加入 agent_* / last_seen_at 列,支持 agent 远程浏览器注册与心跳
db.exec(`
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
    -- 2026-06-06 agent fields (web type uses these for remote launch):
    -- agent_token:    per-device bearer token, generated on create, used as
    --                 Authorization: Bearer for all agent <-> server comms
    -- agent_endpoint: agent's reachable HTTP URL, e.g. http://192.168.1.50:4001
    -- agent_version:  last seen agent version string
    -- last_seen_at:   separate from last_heartbeat (which is for general status
    --                 refresh). last_seen_at is the agent heartbeat timestamp.
    agent_token TEXT,
    agent_endpoint TEXT,
    agent_version TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_devices_test_type ON devices(test_type);
`);

// 2026-06-06: idempotent migration for the new agent_* / last_seen_at columns
// on already-existing devices tables. Same try/catch PRAGMA pattern as the
// rest of this file. Must run BEFORE the unique index on agent_token.
const deviceAgentCols: { col: string; ddl: string }[] = [
  { col: 'agent_token', ddl: 'ALTER TABLE devices ADD COLUMN agent_token TEXT' },
  { col: 'agent_endpoint', ddl: 'ALTER TABLE devices ADD COLUMN agent_endpoint TEXT' },
  { col: 'agent_version', ddl: 'ALTER TABLE devices ADD COLUMN agent_version TEXT' },
  { col: 'last_seen_at', ddl: 'ALTER TABLE devices ADD COLUMN last_seen_at TEXT' },
];
for (const { ddl } of deviceAgentCols) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

// 2026-06-07: SSH push / upgrade fields. ssh_* are user-supplied connection
// details (encrypted at rest), needs_upgrade is set by the server's startup
// version scan, and last_push_* is the audit trail of the last SSH push.
const devicePushCols: { col: string; ddl: string }[] = [
  { col: 'ssh_host', ddl: 'ALTER TABLE devices ADD COLUMN ssh_host TEXT' },
  { col: 'ssh_port', ddl: 'ALTER TABLE devices ADD COLUMN ssh_port INTEGER DEFAULT 22' },
  { col: 'ssh_user', ddl: 'ALTER TABLE devices ADD COLUMN ssh_user TEXT' },
  { col: 'ssh_auth_type', ddl: 'ALTER TABLE devices ADD COLUMN ssh_auth_type TEXT' },
  { col: 'ssh_password', ddl: 'ALTER TABLE devices ADD COLUMN ssh_password TEXT' },
  { col: 'ssh_private_key', ddl: 'ALTER TABLE devices ADD COLUMN ssh_private_key TEXT' },
  { col: 'os_type', ddl: "ALTER TABLE devices ADD COLUMN os_type TEXT DEFAULT 'linux'" },
  { col: 'needs_upgrade', ddl: 'ALTER TABLE devices ADD COLUMN needs_upgrade INTEGER DEFAULT 0' },
  { col: 'last_push_at', ddl: 'ALTER TABLE devices ADD COLUMN last_push_at TEXT' },
  { col: 'last_push_status', ddl: 'ALTER TABLE devices ADD COLUMN last_push_status TEXT' },
  { col: 'last_push_error', ddl: 'ALTER TABLE devices ADD COLUMN last_push_error TEXT' },
];
for (const { ddl } of devicePushCols) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

// 2026-06-08: Mobile 屏幕预览字段。preview_kind 决定走 scrcpy / mjpeg / screenshot 哪条
// relay 路径;last_rich_info_at 标记上次从 adb / hdc / xcrun 查到完整 rich info 的时间,
// 30s 内 merge.ts 不会重跑慢查询;ssh_tunnel_port 是 server 端 SSH LocalForward 占用的
// 127.0.0.1 端口,避免多 agent 端口冲突;mobile_agent_port 跟 web agent 区分(4002 vs 4001)。
const devicePreviewCols: { col: string; ddl: string }[] = [
  { col: 'preview_kind', ddl: "ALTER TABLE devices ADD COLUMN preview_kind TEXT" },
  { col: 'last_rich_info_at', ddl: 'ALTER TABLE devices ADD COLUMN last_rich_info_at TEXT' },
  { col: 'ssh_tunnel_port', ddl: 'ALTER TABLE devices ADD COLUMN ssh_tunnel_port INTEGER' },
  { col: 'mobile_agent_port', ddl: 'ALTER TABLE devices ADD COLUMN mobile_agent_port INTEGER DEFAULT 4002' },
];
for (const { ddl } of devicePreviewCols) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_agent_token ON devices(agent_token);`);

// ── Web case execution 表（标准化 + Midscene 报告）──
db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (case_id) REFERENCES web_test_cases(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_web_case_executions_case_id ON web_case_executions(case_id);
  CREATE INDEX IF NOT EXISTS idx_web_case_executions_user_id ON web_case_executions(user_id);
`);

// 2026-06-20: web_case_executions 加 device_id 列 + busy 锁 UNIQUE INDEX
{
  const cols = db.prepare("PRAGMA table_info(web_case_executions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'device_id')) {
    db.exec(`ALTER TABLE web_case_executions ADD COLUMN device_id INTEGER DEFAULT NULL REFERENCES devices(id) ON DELETE SET NULL`);
    console.log('[db] added device_id column to web_case_executions');
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_web_case_executions_running_per_device
    ON web_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;
`);

// ── Web case log 表（兼容现有 createWebCaseLog 接口）──
db.exec(`
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
`);

// ── PC case execution 表（标准化 + Midscene 报告）──
db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (case_id) REFERENCES pc_test_cases(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_pc_case_executions_case_id ON pc_case_executions(case_id);
  CREATE INDEX IF NOT EXISTS idx_pc_case_executions_user_id ON pc_case_executions(user_id);
`);

// 2026-06-20: pc_case_executions 加 device_id 列 + busy 锁 UNIQUE INDEX
{
  const cols = db.prepare("PRAGMA table_info(pc_case_executions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'device_id')) {
    db.exec(`ALTER TABLE pc_case_executions ADD COLUMN device_id INTEGER DEFAULT NULL REFERENCES devices(id) ON DELETE SET NULL`);
    console.log('[db] added device_id column to pc_case_executions');
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_case_executions_running_per_device
    ON pc_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;
`);

// ── PC case log 表（兼容现有 createPcCaseLog 接口）──
db.exec(`
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
`);

// ── Mobile case execution 表（标准化 + Midscene 报告）──
db.exec(`
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
`);

// 2026-06-10: 设备级执行 busy 锁 — partial UNIQUE INDEX 兜底多进程/未来多 server 场景。
// 单进程内由 routes/mobile-tests.ts 的 in-memory mutex + findRunningExecutionByDevice
// 查询主导,这条 UNIQUE INDEX 是 defense-in-depth:即使 mutex 因故失败,DB 层也会拒绝
// 第二个 running 行落入同 device_id。
// 注意:SQLite partial index 的 WHERE 子句必须是确定性表达式;`status='running'` 在
// row update 触发 index re-eval 时会让 old running row 退出索引,所以历史 finished
// 行不会无限累积索引项。
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_case_executions_running_per_device
    ON mobile_case_executions(device_id) WHERE status = 'running' AND device_id IS NOT NULL;
`);

// 2026-06-11: 本地设备 busy 锁 — local_device_key 存 `local:android:<serial>` 等字符串,
// 远程设备用 device_id(integer)。两列互斥,各管各的 UNIQUE INDEX。
// PRAGMA + ALTER 迁移:已有表加列,不破坏数据。
{
  const cols = db.prepare("PRAGMA table_info(mobile_case_executions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'local_device_key')) {
    db.exec(`ALTER TABLE mobile_case_executions ADD COLUMN local_device_key TEXT DEFAULT NULL`);
    console.log('[db] added local_device_key column to mobile_case_executions');
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_case_executions_running_per_local_device
    ON mobile_case_executions(local_device_key) WHERE status = 'running' AND local_device_key IS NOT NULL;
`);

// ── Mobile test log 表（兼容现有 createMobileTestLog 接口）──
db.exec(`
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
`);

// ── Mobile case preview session 表 (2026-06-08) ──
// 跟 mobile_case_executions 1:1,记录本次执行开启的预览会话:
//   preview_kind  决定用 scrcpy(H.264) / mjpeg / screenshot(SSE-JPEG) 哪条中转
//   session_id    server 端 preview-manager 内部的会话 id,client 拿它开 WebSocket
//   started_at / stopped_at  排错用
//   total_frames  累计接收的视频帧 / 截图数,远端断流时通过它判断卡顿
//   last_frame_at 最后收到一帧的时间,排错用
db.exec(`
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
    color TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  )`);
}
// Migration: add color column if missing
const tagCols = db.prepare("PRAGMA table_info(user_tags)").all() as { name: string }[];
if (!tagCols.some(c => c.name === 'color')) {
  db.exec("ALTER TABLE user_tags ADD COLUMN color TEXT DEFAULT ''");
}

// ── mock_endpoints_api (仅 API 端使用 mock) ──
db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_mock_endpoints_api_user_id ON mock_endpoints_api(user_id);
`);

// ── 新建 case_sets / schedule_sets 分表 (2026-06-05 重构) ──
// 用途: web/pc/mobile 移除 scenarios/scenario_sets 子树,改用 case_sets
// 存 test_case_ids 引用;schedule_sets 也按测试类型拆 4 张。
// API 端 schedule_sets 表名保持(由 schedule-sets-api.ts 用)。
for (const t of ['web', 'pc', 'mobile'] as const) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_sets_${t} (
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
    CREATE INDEX IF NOT EXISTS idx_case_sets_${t}_user_id ON case_sets_${t}(user_id);

    CREATE TABLE IF NOT EXISTS case_set_executions_${t} (
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
      FOREIGN KEY (set_id) REFERENCES case_sets_${t}(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_case_set_executions_${t}_set_id ON case_set_executions_${t}(set_id);

    CREATE TABLE IF NOT EXISTS case_set_execution_items_${t} (
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
      FOREIGN KEY (set_execution_id) REFERENCES case_set_executions_${t}(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_case_set_execution_items_${t}_set_exec_id ON case_set_execution_items_${t}(set_execution_id);
  `);
}

// schedule_sets_* 分表(2026-06-05 重构):
//   - api 端:scenario_set_id 列(指向 scenario_sets.id),与老 schedule-sets.ts 兼容
//   - web/pc/mobile 端:case_set_id 列(指向各自 case_sets_*.id)
// 不在上面的 case_sets_* 循环里建,避免与已存在的 schedule_sets_api(scenario_set_id)冲突。
for (const t of ['web', 'pc', 'mobile'] as const) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_sets_${t} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_set_id INTEGER NOT NULL,
      cron_expr TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      next_run_at TEXT,
      last_run_at TEXT,
      last_run_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (case_set_id) REFERENCES case_sets_${t}(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_sets_${t}_case_set_id ON schedule_sets_${t}(case_set_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_sets_${t}_status ON schedule_sets_${t}(status, next_run_at);
  `);
}

// API 端的 schedule_sets 表使用 scenario_set_id FK 到 scenario_sets(id) —
// 列名兼容老 schedule-sets.ts 代码(API 端的"集"是场景集,沿用 scenario_set_id 命名)。
db.exec(`
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
`);

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
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
    driver_path TEXT,
    close_browser_after_execution INTEGER DEFAULT 0,
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
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
    driver_path TEXT,
    close_browser_after_execution INTEGER DEFAULT 0,
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
    preconditions TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    case_content TEXT,
    case_content_type TEXT DEFAULT 'text',
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


// ── 2026-06-05: web/pc/mobile 移除 scenarios + scenario_sets,改用 case_sets ──
// 用户已明确授权 DROP,不可恢复。API 端 scenarios/scenario_sets 不动。
// 老的 schedule_sets 表也 DROP,被 schedule_sets_api/web/pc/mobile 4 张表取代
// (api 用 scenario_set_id 列指向 scenario_sets.id;web/pc/mobile 用 case_set_id 列指向各自 case_sets_*.id)。
const SCENARIO_TABLES_TO_DROP = [
  'scenarios_web', 'scenarios_pc', 'scenarios_mobile',
  'scenario_nodes_web', 'scenario_nodes_pc', 'scenario_nodes_mobile',
  'scenario_edges_web', 'scenario_edges_pc', 'scenario_edges_mobile',
  'scenario_logs_web', 'scenario_logs_pc', 'scenario_logs_mobile',
  'scenario_sets_web', 'scenario_sets_pc', 'scenario_sets_mobile',
];
db.exec('PRAGMA foreign_keys = OFF');
try {
  for (const t of SCENARIO_TABLES_TO_DROP) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (exists) {
      db.exec(`DROP TABLE ${t}`);
      console.log(`[DB Migration 2026-06-05] Dropped legacy table ${t} (web/pc/mobile scenarios removed, user authorized)`);
    }
  }
  // 老的 schedule_sets 表(FK 指向 scenario_sets(id) — API 场景集)DROP
  // 新的 schedule_sets_api 表用同名 scenario_set_id 列指向 scenario_sets(id)
  // web/pc/mobile 三张 schedule_sets_* 表用 case_set_id 列指向各自 case_sets_*
  const oldScheduleSets = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_sets'").get();
  if (oldScheduleSets) {
    db.exec('DROP TABLE schedule_sets');
    console.log('[DB Migration 2026-06-05] Dropped legacy schedule_sets table (rebuilt as 4 per-type tables)');
  }
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}

// 2026-06-03 NL 化迁移:旧 {action, desc} 数据无意义,但 DELETE 已被移除,
// 因为这是不可逆的用户数据丢失。前端 step 编辑器 NL 化通过 case_content
// /case_content_type 列和 resolveCaseContent 兜底处理(见 engine/nl-steps.ts),
// 不需要清空历史 case。

// ── 2026-06-23: Mobile apps table — APK/IPA/HAP 包管理 ──
db.exec(`
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
`);

// mobile_test_cases 加 app_id / app_version 列（关联 mobile_apps）
const mobileAppAlter: Array<{ ddl: string }> = [
  { ddl: 'ALTER TABLE mobile_test_cases ADD COLUMN app_id INTEGER' },
  { ddl: 'ALTER TABLE mobile_test_cases ADD COLUMN app_version TEXT' },
];
for (const { ddl } of mobileAppAlter) {
  try { db.exec(ddl); } catch { /* column already exists — ignore */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    test_type TEXT NOT NULL,
    environment_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(user_id, test_type)
  );
`);
// 2026-06-26: 加 value 列，用于存储非环境类偏好（如 theme）
try { db.exec("ALTER TABLE user_preferences ADD COLUMN value TEXT"); } catch { /* column already exists */ }
