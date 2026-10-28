/**
 * Numbered SQLite migrations.
 *
 * openDb() runs CREATE TABLE IF NOT EXISTS (SCHEMA with full current shape), then
 * runAllMigrations(). Ids 1–6 are historical no-ops kept so existing DBs that
 * already recorded them stay valid; fresh installs get SCHEMA then record 1–6
 * without re-running old backfills. New schema changes start at id 7+.
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

function noop(_db: Database.Database): void {
  /* historical — folded into SCHEMA */
}

function migrateUserSegmentUsage(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_segment_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      PRIMARY KEY (user_id, segment_id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_user_segment_usage_segment ON user_segment_usage(segment_id)");

  const soleUser = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!soleUser) return;

  const existing = db.prepare("SELECT 1 FROM user_segment_usage LIMIT 1").get();
  if (existing) return;

  db.prepare(
    `INSERT INTO user_segment_usage (user_id, segment_id, usage_count, last_used_at)
     SELECT ?, segment_id, usage_count, last_used_at
     FROM segment_usage
     WHERE usage_count > 0 OR last_used_at IS NOT NULL`,
  ).run(soleUser.id);
}

function migrateOpeningHoursAndWalkMode(db: Database.Database): void {
  addColumnIfMissing(db, "nodes", "open_from_minutes", "ALTER TABLE nodes ADD COLUMN open_from_minutes INTEGER");
  addColumnIfMissing(db, "nodes", "open_until_minutes", "ALTER TABLE nodes ADD COLUMN open_until_minutes INTEGER");
  addColumnIfMissing(
    db,
    "active_route",
    "walk_mode",
    "ALTER TABLE active_route ADD COLUMN walk_mode TEXT NOT NULL DEFAULT 'route'",
  );
  addColumnIfMissing(db, "active_route", "guide_node_ids", "ALTER TABLE active_route ADD COLUMN guide_node_ids TEXT");
}

function migratePerUserTimezone(db: Database.Database): void {
  addColumnIfMissing(db, "users", "timezone", "ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Vienna'");
}

function migrateAchievementsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      earned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
  `);
}

function migrateFreeRoamCompleted(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS free_roam_completed (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      walk_id INTEGER REFERENCES walk_log(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_free_roam_completed_at ON free_roam_completed(completed_at);
  `);
}

function migrateShareExpiry(db: Database.Database): void {
  addColumnIfMissing(
    db,
    "favorite_route",
    "share_expires_at",
    "ALTER TABLE favorite_route ADD COLUMN share_expires_at TEXT",
  );
}

function migratePendingTotp(db: Database.Database): void {
  // M2-1/F07: a setup-in-progress secret must not replace the live totp_secret
  // (or disable 2FA). Keep the pending secret in its own column until confirmed.
  addColumnIfMissing(db, "users", "totp_pending_secret", "ALTER TABLE users ADD COLUMN totp_pending_secret TEXT");
}

function migrateWalkGeometryAnalysis(db: Database.Database): void {
  // Persistente Track-Geometry-Analyse (0.57): Die aufwendige Segment-Aufteilung
  // wird genau EINMAL beim Einspeisen gerechnet und hier gespeichert — stattdessen
  // wurde sie bei jedem Seitenaufruf neu berechnet (O(n²) über alle Walks, „hängt").
  // status: pending → done → trashed. attempts zählt Fehlschläge für Retry am Start.
  db.exec(`
    CREATE TABLE IF NOT EXISTS walk_geometry_analysis (
      walk_id INTEGER PRIMARY KEY REFERENCES walk_log(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      suggestions_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      analyzed_at TEXT,
      trashed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_walk_geometry_status ON walk_geometry_analysis(status, trashed_at);
  `);
}

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "legacy_schema_hardening", up: noop },
  { id: 2, name: "per_user_home", up: noop },
  { id: 3, name: "walk_points_ledger", up: noop },
  { id: 4, name: "length_taste_and_track", up: noop },
  { id: 5, name: "track_geometry_dismissals", up: noop },
  { id: 6, name: "one_way_and_dismissal_resolution", up: noop },
  { id: 7, name: "user_segment_usage", up: migrateUserSegmentUsage },
  { id: 8, name: "opening_hours_and_walk_mode", up: migrateOpeningHoursAndWalkMode },
  { id: 9, name: "per_user_timezone", up: migratePerUserTimezone },
  { id: 10, name: "achievements_table", up: migrateAchievementsTable },
  { id: 11, name: "free_roam_completed_antireplay", up: migrateFreeRoamCompleted },
  { id: 12, name: "share_link_expiry", up: migrateShareExpiry },
  { id: 13, name: "pending_totp_secret", up: migratePendingTotp },
  { id: 14, name: "walk_geometry_analysis", up: migrateWalkGeometryAnalysis },
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
    migration.up(db);
    try {
      insert.run(migration.id, migration.name);
    } catch (err) {
      const isUnique =
        err instanceof DatabaseCtor.SqliteError &&
        (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || err.code === "SQLITE_CONSTRAINT");
      if (!isUnique) throw err;
    }
  }

  // Seed default settings on fresh DBs (was part of migration 4).
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(
    "golden_percent",
    "5",
  );
}
