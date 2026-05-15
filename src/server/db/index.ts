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
const db = new Database(dbPath);

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

// ── Scenario tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    tags TEXT DEFAULT '',
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

export default db;
