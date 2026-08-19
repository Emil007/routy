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

/**
 * Next.js's build spawns several worker processes that each open this same
 * SQLite file and run migrations concurrently — two can both see a column
 * missing via PRAGMA before either has added it, then race the ALTER. Rather
 * than serialize startup across processes, just treat "someone else already
 * added it" as success.
 */
function addColumnIfMissing(db: Database.Database, table: string, column: string, alterSql: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(alterSql);
  } catch (err) {
    const isConcurrentDuplicate =
      err instanceof Database.SqliteError && err.code === "SQLITE_ERROR" && /duplicate column name/i.test(err.message);
    if (!isConcurrentDuplicate) throw err;
  }
}

/** Column additions to already-deployed tables — CREATE TABLE IF NOT EXISTS above only covers fresh installs. */
function runMigrations(db: Database.Database): void {
  addColumnIfMissing(db, "users", "walk_speed_kmh", "ALTER TABLE users ADD COLUMN walk_speed_kmh REAL");
  addColumnIfMissing(db, "users", "role", "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "users", "active", "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "users", "deleted_at", "ALTER TABLE users ADD COLUMN deleted_at TEXT");
  addColumnIfMissing(db, "users", "theme", "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto'");
  addColumnIfMissing(db, "users", "totp_secret", "ALTER TABLE users ADD COLUMN totp_secret TEXT");
  addColumnIfMissing(db, "users", "totp_enabled", "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");

  addColumnIfMissing(db, "nodes", "created_by", "ALTER TABLE nodes ADD COLUMN created_by INTEGER REFERENCES users(id)");
  addColumnIfMissing(
    db,
    "nodes",
    "name_part_1_id",
    "ALTER TABLE nodes ADD COLUMN name_part_1_id INTEGER REFERENCES name_parts(id)",
  );
  addColumnIfMissing(
    db,
    "nodes",
    "name_part_2_id",
    "ALTER TABLE nodes ADD COLUMN name_part_2_id INTEGER REFERENCES name_parts(id)",
  );
  addColumnIfMissing(db, "nodes", "name_separator", "ALTER TABLE nodes ADD COLUMN name_separator TEXT NOT NULL DEFAULT '/'");
  addColumnIfMissing(db, "nodes", "active", "ALTER TABLE nodes ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "nodes", "deleted_at", "ALTER TABLE nodes ADD COLUMN deleted_at TEXT");

  addColumnIfMissing(db, "segments", "name", "ALTER TABLE segments ADD COLUMN name TEXT");
  addColumnIfMissing(db, "segments", "active", "ALTER TABLE segments ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "segments", "deleted_at", "ALTER TABLE segments ADD COLUMN deleted_at TEXT");
  addColumnIfMissing(db, "segments", "locked_until", "ALTER TABLE segments ADD COLUMN locked_until TEXT");
  addColumnIfMissing(db, "segments", "locked_reason", "ALTER TABLE segments ADD COLUMN locked_reason TEXT");

  addColumnIfMissing(db, "active_route", "nickname", "ALTER TABLE active_route ADD COLUMN nickname TEXT");

  addColumnIfMissing(db, "walk_log", "nickname", "ALTER TABLE walk_log ADD COLUMN nickname TEXT");

  addColumnIfMissing(db, "favorite_route", "share_token", "ALTER TABLE favorite_route ADD COLUMN share_token TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_route_share_token ON favorite_route(share_token)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_avoid_segment (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, segment_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_condition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_segment_condition_segment ON segment_condition(segment_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_segment_condition_expires ON segment_condition(expires_at)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_proposal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_segment_proposal_status ON segment_proposal(status)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS crash_report (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      stack TEXT,
      app_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  addColumnIfMissing(db, "nodes", "updated_at", "ALTER TABLE nodes ADD COLUMN updated_at TEXT");
  addColumnIfMissing(db, "segments", "updated_at", "ALTER TABLE segments ADD COLUMN updated_at TEXT");
  db.exec("UPDATE nodes SET updated_at = created_at WHERE updated_at IS NULL");
  db.exec("UPDATE segments SET updated_at = created_at WHERE updated_at IS NULL");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_nodes_updated_at
    AFTER UPDATE ON nodes
    BEGIN
      UPDATE nodes SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_segments_updated_at
    AFTER UPDATE ON segments
    BEGIN
      UPDATE segments SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `);

  // session_id is a non-secret handle for the sessions list / revoke UI —
  // separate from token_hash, which stays internal since it's derived from
  // the actual bearer/cookie secret.
  const sessionColumnsBefore = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const hadSessionId = sessionColumnsBefore.some((c) => c.name === "session_id");
  addColumnIfMissing(db, "sessions", "session_id", "ALTER TABLE sessions ADD COLUMN session_id TEXT");
  if (!hadSessionId) {
    db.exec("UPDATE sessions SET session_id = lower(hex(randomblob(8))) WHERE session_id IS NULL");
  }
  addColumnIfMissing(db, "sessions", "device_name", "ALTER TABLE sessions ADD COLUMN device_name TEXT");
  addColumnIfMissing(db, "sessions", "client", "ALTER TABLE sessions ADD COLUMN client TEXT NOT NULL DEFAULT 'web'");
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
