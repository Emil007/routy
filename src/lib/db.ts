import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runAllMigrations } from "./migrations";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS name_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  is_home INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  name_part_1_id INTEGER REFERENCES name_parts(id),
  name_part_2_id INTEGER REFERENCES name_parts(id),
  name_separator TEXT NOT NULL DEFAULT '/',
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
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
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  locked_until TEXT,
  locked_reason TEXT,
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
  nickname TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_walk_log_accepted_at ON walk_log(accepted_at);
CREATE INDEX IF NOT EXISTS idx_walk_log_user ON walk_log(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- A route a profile has accepted but not yet confirmed as walked. One per
-- profile; it persists in the database (not just an in-memory session) so it
-- shows up on any device that profile signs in on until confirmed or discarded.
CREATE TABLE IF NOT EXISTS active_route (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  nickname TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorite_route (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  share_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_favorite_route_user ON favorite_route(user_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS user_avoid_segment (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, segment_id)
);

CREATE TABLE IF NOT EXISTS segment_condition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segment_condition_segment ON segment_condition(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_condition_expires ON segment_condition(expires_at);

CREATE TABLE IF NOT EXISTS segment_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segment_proposal_status ON segment_proposal(status);

CREATE TABLE IF NOT EXISTS crash_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  stack TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  runAllMigrations(db);
  return db;
}

// Reuse a single connection across hot reloads / module re-evaluation in dev.
export const db: Database.Database = globalThis.__routyDb ?? openDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__routyDb = db;
}
