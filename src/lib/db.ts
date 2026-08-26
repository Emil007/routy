import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAllMigrations } from "./migrations";

/**
 * Full current schema (post-0.44). Fresh installs get everything here.
 * Historical migrations 1–6 are no-ops; new changes go in migrations.ts from id 7+.
 */
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
  walk_speed_kmh REAL,
  theme TEXT NOT NULL DEFAULT 'auto',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  home_node_id INTEGER,
  taste_short_m REAL,
  taste_normal_m REAL,
  taste_long_m REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  session_id TEXT,
  device_name TEXT,
  client TEXT NOT NULL DEFAULT 'web'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);

CREATE TABLE IF NOT EXISTS name_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  display_text TEXT,
  speak_text TEXT,
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
  updated_at TEXT,
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
  updated_at TEXT,
  duration_from_gps INTEGER NOT NULL DEFAULT 0,
  one_way INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_start ON segments(start_node_id);
CREATE INDEX IF NOT EXISTS idx_segments_end ON segments(end_node_id);

CREATE TABLE IF NOT EXISTS segment_usage (
  segment_id INTEGER PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS user_segment_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  PRIMARY KEY (user_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_user_segment_usage_segment ON user_segment_usage(segment_id);

CREATE TABLE IF NOT EXISTS walk_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  nickname TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  points_earned INTEGER,
  points_base INTEGER,
  points_golden INTEGER,
  points_exploration INTEGER,
  points_diversity INTEGER,
  streak_multiplier REAL,
  celebration_tier TEXT,
  golden_hits INTEGER,
  length_rating INTEGER,
  track_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_walk_log_accepted_at ON walk_log(accepted_at);
CREATE INDEX IF NOT EXISTS idx_walk_log_user ON walk_log(user_id);

CREATE TABLE IF NOT EXISTS walk_track (
  walk_id INTEGER PRIMARY KEY REFERENCES walk_log(id) ON DELETE CASCADE,
  points_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segment_geometry_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  geometry_json TEXT NOT NULL,
  length_m REAL,
  ele_gain_m REAL,
  ele_loss_m REAL,
  duration_min REAL,
  backed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);

CREATE TABLE IF NOT EXISTS track_geometry_dismissals (
  walk_id INTEGER NOT NULL REFERENCES walk_log(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolution TEXT NOT NULL DEFAULT 'discarded',
  PRIMARY KEY (walk_id, segment_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_route_share_token ON favorite_route(share_token);

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
  expires_at TEXT,
  reason TEXT,
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

CREATE TABLE IF NOT EXISTS segment_lock_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segment_lock_proposal_status ON segment_lock_proposal(status);

CREATE TABLE IF NOT EXISTS golden_segments (
  utc_date TEXT NOT NULL,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  multiplier REAL NOT NULL DEFAULT 3.0,
  PRIMARY KEY (utc_date, segment_id)
);

CREATE TABLE IF NOT EXISTS crash_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  stack TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_nodes_updated_at
AFTER UPDATE ON nodes
BEGIN
  UPDATE nodes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_segments_updated_at
AFTER UPDATE ON segments
BEGIN
  UPDATE segments SET updated_at = datetime('now') WHERE id = NEW.id;
END;
`;

declare global {
   
  var __routyDb: Database.Database | undefined;
}

function openDb(): Database.Database {
  const dbPath =
    process.env.DATABASE_PATH ||
    (process.env.VITEST
      ? path.join(os.tmpdir(), `routy-vitest-${process.pid}.db`)
      : path.join(process.cwd(), "data", "routy.db"));
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
