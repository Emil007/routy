import { db } from "./db";
import { getSegment } from "./segments";

/** Per-user soft-avoid segment IDs — routing penalizes but does not exclude. */
export function listAvoidSegmentIds(userId: number): number[] {
  const rows = db
    .prepare("SELECT segment_id FROM user_avoid_segment WHERE user_id = ? ORDER BY segment_id")
    .all(userId) as { segment_id: number }[];
  return rows.map((r) => r.segment_id);
}

export function getAvoidSegmentSet(userId: number): Set<number> {
  return new Set(listAvoidSegmentIds(userId));
}

export function addAvoidSegment(userId: number, segmentId: number): boolean {
  const segment = getSegment(segmentId);
  if (!segment) return false;
  db.prepare(
    "INSERT OR IGNORE INTO user_avoid_segment (user_id, segment_id) VALUES (?, ?)",
  ).run(userId, segmentId);
  return true;
}

export function removeAvoidSegment(userId: number, segmentId: number): void {
  db.prepare("DELETE FROM user_avoid_segment WHERE user_id = ? AND segment_id = ?").run(userId, segmentId);
}
