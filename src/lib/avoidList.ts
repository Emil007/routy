import { db } from "./db";
import { directedPairIds, getSegment } from "./segments";

/** Per-user soft-avoid segment IDs — routing penalizes but does not exclude. */
export function listAvoidSegmentIds(userId: number): number[] {
  const rows = db
    .prepare("SELECT segment_id FROM user_avoid_segment WHERE user_id = ? ORDER BY segment_id")
    .all(userId) as { segment_id: number }[];
  return rows.map((r) => r.segment_id);
}

export function getAvoidSegmentSet(userId: number): Set<number> {
  const set = new Set<number>();
  for (const id of listAvoidSegmentIds(userId)) {
    for (const directed of directedPairIds(id)) set.add(directed);
  }
  return set;
}

export function addAvoidSegment(userId: number, segmentId: number): boolean {
  const segment = getSegment(segmentId);
  if (!segment) return false;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_avoid_segment (user_id, segment_id) VALUES (?, ?)",
  );
  for (const id of directedPairIds(segmentId)) {
    insert.run(userId, id);
  }
  return true;
}

export function removeAvoidSegment(userId: number, segmentId: number): void {
  const del = db.prepare("DELETE FROM user_avoid_segment WHERE user_id = ? AND segment_id = ?");
  for (const id of directedPairIds(segmentId)) {
    del.run(userId, id);
  }
}
