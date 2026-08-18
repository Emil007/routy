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
`;

/** Column additions to already-deployed tables — CREATE TABLE IF NOT EXISTS above only covers fresh installs. */
function runMigrations(db: Database.Database): void {
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userColumns.some((c) => c.name === "walk_speed_kmh")) {
    db.exec("ALTER TABLE users ADD COLUMN walk_speed_kmh REAL");
  }
  if (!userColumns.some((c) => c.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!userColumns.some((c) => c.name === "active")) {
    db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!userColumns.some((c) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
  }
  if (!userColumns.some((c) => c.name === "theme")) {
    db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto'");
  }
  if (!userColumns.some((c) => c.name === "totp_secret")) {
    db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
  }
  if (!userColumns.some((c) => c.name === "totp_enabled")) {
    db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
  }

  const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
  if (!nodeColumns.some((c) => c.name === "created_by")) {
    db.exec("ALTER TABLE nodes ADD COLUMN created_by INTEGER REFERENCES users(id)");
  }
  if (!nodeColumns.some((c) => c.name === "name_part_1_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN name_part_1_id INTEGER REFERENCES name_parts(id)");
  }
  if (!nodeColumns.some((c) => c.name === "name_part_2_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN name_part_2_id INTEGER REFERENCES name_parts(id)");
  }
  if (!nodeColumns.some((c) => c.name === "name_separator")) {
    db.exec("ALTER TABLE nodes ADD COLUMN name_separator TEXT NOT NULL DEFAULT '/'");
  }
  if (!nodeColumns.some((c) => c.name === "active")) {
    db.exec("ALTER TABLE nodes ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!nodeColumns.some((c) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE nodes ADD COLUMN deleted_at TEXT");
  }

  const segmentColumns = db.prepare("PRAGMA table_info(segments)").all() as { name: string }[];
  if (!segmentColumns.some((c) => c.name === "name")) {
    db.exec("ALTER TABLE segments ADD COLUMN name TEXT");
  }
  if (!segmentColumns.some((c) => c.name === "active")) {
    db.exec("ALTER TABLE segments ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!segmentColumns.some((c) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE segments ADD COLUMN deleted_at TEXT");
  }
  if (!segmentColumns.some((c) => c.name === "locked_until")) {
    db.exec("ALTER TABLE segments ADD COLUMN locked_until TEXT");
  }
  if (!segmentColumns.some((c) => c.name === "locked_reason")) {
    db.exec("ALTER TABLE segments ADD COLUMN locked_reason TEXT");
  }

  const activeRouteColumns = db.prepare("PRAGMA table_info(active_route)").all() as { name: string }[];
  if (!activeRouteColumns.some((c) => c.name === "nickname")) {
    db.exec("ALTER TABLE active_route ADD COLUMN nickname TEXT");
  }

  const walkLogColumns = db.prepare("PRAGMA table_info(walk_log)").all() as { name: string }[];
  if (!walkLogColumns.some((c) => c.name === "nickname")) {
    db.exec("ALTER TABLE walk_log ADD COLUMN nickname TEXT");
  }

  const favoriteRouteColumns = db.prepare("PRAGMA table_info(favorite_route)").all() as { name: string }[];
  if (!favoriteRouteColumns.some((c) => c.name === "share_token")) {
    db.exec("ALTER TABLE favorite_route ADD COLUMN share_token TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_route_share_token ON favorite_route(share_token)");

  // session_id is a non-secret handle for the sessions list / revoke UI —
  // separate from token_hash, which stays internal since it's derived from
  // the actual bearer/cookie secret.
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!sessionColumns.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN session_id TEXT");
    db.exec("UPDATE sessions SET session_id = lower(hex(randomblob(8))) WHERE session_id IS NULL");
  }
  if (!sessionColumns.some((c) => c.name === "device_name")) {
    db.exec("ALTER TABLE sessions ADD COLUMN device_name TEXT");
  }
  if (!sessionColumns.some((c) => c.name === "client")) {
    db.exec("ALTER TABLE sessions ADD COLUMN client TEXT NOT NULL DEFAULT 'web'");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)");

  // One-time promotion: on an already-deployed instance with no admin yet, the
  // earliest account becomes admin, and any pre-existing nodes/segments with no
  // owner (created before this feature existed) are attributed to them.
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!hasAdmin) {
    const firstUser = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (firstUser) {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
      db.prepare("UPDATE nodes SET created_by = ? WHERE created_by IS NULL").run(firstUser.id);
      db.prepare("UPDATE segments SET submitted_by = ? WHERE submitted_by IS NULL").run(firstUser.id);
    }
  }
}

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
  runMigrations(db);
  return db;
}

// Reuse a single connection across hot reloads / module re-evaluation in dev.
export const db: Database.Database = globalThis.__routyDb ?? openDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__routyDb = db;
}
