import { db } from "./db";
import { log } from "./logger";

const RETENTION_DAYS = 30;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function purgeOldTrash(): void {
  const cutoff = `-${RETENTION_DAYS} days`;
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

/** Runs once on startup, then daily — permanently removes trash older than 30 days. */
export function startPurgeSchedule(): void {
  purgeOldTrash();
  setInterval(purgeOldTrash, INTERVAL_MS);
}
