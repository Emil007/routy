/**
 * Numbered SQLite migrations (IMP-4).
 *
 * openDb() runs CREATE TABLE IF NOT EXISTS (SCHEMA), then runAllMigrations().
 * Each migration has a stable integer id; applied ids are recorded in
 * schema_migrations so steps run once. Prefer idempotent DDL (addColumnIfMissing /
 * CREATE IF NOT EXISTS) so concurrent Next workers racing startup stay safe.
 * Wrap multi-statement data changes in db.transaction when atomicity matters.
 */
import type Database from "better-sqlite3";
import DatabaseCtor from "better-sqlite3";

export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  alterSql: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(alterSql);
  } catch (err) {
    const isConcurrentDuplicate =
      err instanceof DatabaseCtor.SqliteError &&
      err.code === "SQLITE_ERROR" &&
      /duplicate column name/i.test(err.message);
    if (!isConcurrentDuplicate) throw err;
  }
}

export interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

/** All existing ad-hoc schema hardening from the former runMigrations body. */
function legacySchemaHardening(db: Database.Database): void {
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

  addColumnIfMissing(db, "user_avoid_segment", "expires_at", "ALTER TABLE user_avoid_segment ADD COLUMN expires_at TEXT");
  addColumnIfMissing(db, "user_avoid_segment", "reason", "ALTER TABLE user_avoid_segment ADD COLUMN reason TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_lock_proposal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT,
      days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_segment_lock_proposal_status ON segment_lock_proposal(status)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS golden_segments (
      utc_date TEXT NOT NULL,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      multiplier REAL NOT NULL DEFAULT 3.0,
      PRIMARY KEY (utc_date, segment_id)
    );
  `);

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

function perUserHome(db: Database.Database): void {
  addColumnIfMissing(
    db,
    "users",
    "home_node_id",
    "ALTER TABLE users ADD COLUMN home_node_id INTEGER REFERENCES nodes(id)",
  );

  const globalHome = db.prepare("SELECT id FROM nodes WHERE is_home = 1 LIMIT 1").get() as { id: number } | undefined;
  if (globalHome) {
    db.prepare("UPDATE users SET home_node_id = ? WHERE home_node_id IS NULL").run(globalHome.id);
  }
  // nodes.is_home kept as unused legacy / optional display — not cleared.
}

/** Best-effort preview formula (streak ×1.0) for ledger backfill — mirrors points.ts without importing it. */
function backfillPreview(
  segmentIds: number[],
  lengthM: number,
  canonicalUsage: Map<number, number>,
  goldenMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): { base: number; golden: number; exploration: number; diversity: number; total: number; goldenHits: number } {
  const base = Math.round(lengthM / 100) + 50;
  let golden = 0;
  const seenGolden = new Set<number>();
  let goldenHits = 0;
  for (const id of segmentIds) {
    const canon = canonicalOf.get(id) ?? id;
    if (seenGolden.has(canon)) continue;
    seenGolden.add(canon);
    const mult = goldenMap.get(canon) ?? goldenMap.get(id);
    if (mult) {
      goldenHits++;
      golden += Math.round(base * 0.1 * (mult - 1));
    }
  }
  const routeCanons = [...new Set(segmentIds.map((id) => canonicalOf.get(id) ?? id))];
  const unexplored = routeCanons.filter((c) => (canonicalUsage.get(c) ?? 0) === 0).length;
  const exploration = unexplored * 8;
  const usageValues = [...canonicalUsage.values()].sort((a, b) => a - b);
  const quartile = usageValues.length > 0 ? usageValues[Math.floor(usageValues.length * 0.25)] ?? 0 : 0;
  let diversity = 0;
  for (const canon of routeCanons) {
    if ((canonicalUsage.get(canon) ?? 0) <= quartile) diversity += 5;
  }
  const total = base + golden + exploration + diversity;
  return { base, golden, exploration, diversity, total, goldenHits };
}

function walkPointsLedger(db: Database.Database): void {
  addColumnIfMissing(db, "walk_log", "points_earned", "ALTER TABLE walk_log ADD COLUMN points_earned INTEGER");
  addColumnIfMissing(db, "walk_log", "points_base", "ALTER TABLE walk_log ADD COLUMN points_base INTEGER");
  addColumnIfMissing(db, "walk_log", "points_golden", "ALTER TABLE walk_log ADD COLUMN points_golden INTEGER");
  addColumnIfMissing(db, "walk_log", "points_exploration", "ALTER TABLE walk_log ADD COLUMN points_exploration INTEGER");
  addColumnIfMissing(db, "walk_log", "points_diversity", "ALTER TABLE walk_log ADD COLUMN points_diversity INTEGER");
  addColumnIfMissing(db, "walk_log", "streak_multiplier", "ALTER TABLE walk_log ADD COLUMN streak_multiplier REAL");
  addColumnIfMissing(db, "walk_log", "celebration_tier", "ALTER TABLE walk_log ADD COLUMN celebration_tier TEXT");
  addColumnIfMissing(db, "walk_log", "golden_hits", "ALTER TABLE walk_log ADD COLUMN golden_hits INTEGER");

  const needsBackfill = db
    .prepare("SELECT 1 FROM walk_log WHERE points_earned IS NULL LIMIT 1")
    .get();
  if (!needsBackfill) return;

  const segments = db.prepare("SELECT id, reverse_of FROM segments").all() as {
    id: number;
    reverse_of: number | null;
  }[];
  const canonicalOf = new Map<number, number>();
  for (const s of segments) {
    canonicalOf.set(s.id, s.reverse_of !== null ? Math.min(s.id, s.reverse_of) : s.id);
  }

  const goldenRows = db.prepare("SELECT utc_date, segment_id, multiplier FROM golden_segments").all() as {
    utc_date: string;
    segment_id: number;
    multiplier: number;
  }[];
  const goldenByDate = new Map<string, Map<number, number>>();
  for (const row of goldenRows) {
    let map = goldenByDate.get(row.utc_date);
    if (!map) {
      map = new Map();
      goldenByDate.set(row.utc_date, map);
    }
    map.set(row.segment_id, row.multiplier);
  }

  const walks = db
    .prepare("SELECT id, length_m, segment_ids, accepted_at FROM walk_log WHERE points_earned IS NULL ORDER BY accepted_at, id")
    .all() as { id: number; length_m: number; segment_ids: string; accepted_at: string }[];

  const canonicalUsage = new Map<number, number>();
  const update = db.prepare(
    `UPDATE walk_log SET
      points_earned = ?, points_base = ?, points_golden = ?, points_exploration = ?, points_diversity = ?,
      streak_multiplier = 1.0, celebration_tier = 'normal', golden_hits = ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    for (const walk of walks) {
      const segmentIds = JSON.parse(walk.segment_ids) as number[];
      const utcDate = walk.accepted_at.slice(0, 10).replace(" ", "T").slice(0, 10);
      const goldenMap = goldenByDate.get(utcDate) ?? new Map();
      const preview = backfillPreview(segmentIds, walk.length_m, canonicalUsage, goldenMap, canonicalOf);
      update.run(
        preview.total,
        preview.base,
        preview.golden,
        preview.exploration,
        preview.diversity,
        preview.goldenHits,
        walk.id,
      );
      for (const id of segmentIds) {
        const canon = canonicalOf.get(id) ?? id;
        canonicalUsage.set(canon, (canonicalUsage.get(canon) ?? 0) + 1);
      }
    }
  });
  tx();
}

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "legacy_schema_hardening", up: legacySchemaHardening },
  { id: 2, name: "per_user_home", up: perUserHome },
  { id: 3, name: "walk_points_ledger", up: walkPointsLedger },
];

export function runAllMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
  );

  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, datetime('now'))",
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // DDL (ADD COLUMN) cannot run inside a SQLite transaction meaningfully for
    // concurrent safety; data backfills inside each up() use their own tx.
    migration.up(db);
    try {
      insert.run(migration.id, migration.name);
    } catch (err) {
      // Another worker may have recorded the same id after we both ran idempotent DDL.
      const isUnique =
        err instanceof DatabaseCtor.SqliteError &&
        (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || err.code === "SQLITE_CONSTRAINT");
      if (!isUnique) throw err;
    }
  }
}
