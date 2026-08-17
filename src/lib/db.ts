import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  is_home INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  end_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  geometry TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  ele_gain_m INTEGER,
  ele_loss_m INTEGER,
  ele_min_m INTEGER,
  ele_max_m INTEGER,
  source TEXT NOT NULL DEFAULT 'gpx',
  reverse_of INTEGER REFERENCES segments(id) ON DELETE CASCADE,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_start ON segments(start_node_id);
CREATE INDEX IF NOT EXISTS idx_segments_end ON segments(end_node_id);

CREATE TABLE IF NOT EXISTS segment_usage (
  segment_id INTEGER PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS walk_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_walk_log_accepted_at ON walk_log(accepted_at);
CREATE INDEX IF NOT EXISTS idx_walk_log_user ON walk_log(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

declare global {
   
  var __routyDb: Database.Database | undefined;
}

function openDb(): Database.Database {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "routy.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Reuse a single connection across hot reloads / module re-evaluation in dev.
export const db: Database.Database = globalThis.__routyDb ?? openDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__routyDb = db;
}
