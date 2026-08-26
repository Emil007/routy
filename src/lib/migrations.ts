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

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "legacy_schema_hardening", up: noop },
  { id: 2, name: "per_user_home", up: noop },
  { id: 3, name: "walk_points_ledger", up: noop },
  { id: 4, name: "length_taste_and_track", up: noop },
  { id: 5, name: "track_geometry_dismissals", up: noop },
  { id: 6, name: "one_way_and_dismissal_resolution", up: noop },
  { id: 7, name: "user_segment_usage", up: migrateUserSegmentUsage },
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
