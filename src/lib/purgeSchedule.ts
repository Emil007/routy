import { db } from "./db";
import { log } from "./logger";

const TRASH_RETENTION_DAYS = 30;
const ACTIVITY_LOG_RETENTION_DAYS = 180;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function purgeOldTrash(): void {
  const cutoff = `-${TRASH_RETENTION_DAYS} days`;
  const nodes = db
    .prepare("DELETE FROM nodes WHERE active = 0 AND deleted_at < datetime('now', ?)")
    .run(cutoff);
  const segments = db
    .prepare("DELETE FROM segments WHERE active = 0 AND deleted_at < datetime('now', ?)")
    .run(cutoff);
  if (nodes.changes > 0 || segments.changes > 0) {
    log.info("auto-purged old trash", { nodes: nodes.changes, segments: segments.changes });
  }
}

function purgeOldActivityLog(): void {
  const cutoff = `-${ACTIVITY_LOG_RETENTION_DAYS} days`;
  const result = db.prepare("DELETE FROM activity_log WHERE created_at < datetime('now', ?)").run(cutoff);
  if (result.changes > 0) {
    log.info("auto-purged old activity log entries", { entries: result.changes });
  }
}

function purgeExpiredSessions(): void {
  const auth = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  if (auth.changes > 0) {
    log.info("auto-purged expired auth sessions", { sessions: auth.changes });
  }
}

function runDailyPurge(): void {
  purgeOldTrash();
  purgeOldActivityLog();
  purgeExpiredSessions();
}

/** Runs once on startup, then daily — trash, activity log retention, and expired sessions. */
export function startPurgeSchedule(): void {
  runDailyPurge();
  setInterval(runDailyPurge, INTERVAL_MS);
}
