import { db } from "./db";
import { listSegments } from "./segments";

function canonicalSegmentId(id: number, reverseOf: number | null): number {
  return reverseOf !== null ? Math.min(id, reverseOf) : id;
}

/** Last confirmed walk date (ISO) per canonical segment id for a user. */
export function getUserSegmentLastWalkMap(userId: number): Map<number, string> {
  const rows = db
    .prepare("SELECT segment_ids, accepted_at FROM walk_log WHERE user_id = ? ORDER BY accepted_at")
    .all(userId) as { segment_ids: string; accepted_at: string }[];

  const segments = listSegments();
  const canonicalOf = new Map(segments.map((s) => [s.id, canonicalSegmentId(s.id, s.reverseOf)]));

  const lastWalk = new Map<number, string>();
  for (const row of rows) {
    for (const id of JSON.parse(row.segment_ids) as number[]) {
      const canon = canonicalOf.get(id);
      if (canon === undefined) continue;
      lastWalk.set(canon, row.accepted_at);
    }
  }
  return lastWalk;
}

/** Canonical segment ids the user has not walked in at least `staleDays` days (or never). */
export function getStaleSegmentSet(userId: number, staleDays: number): Set<number> {
  const lastWalk = getUserSegmentLastWalkMap(userId);
  const cutoff = Date.now() - staleDays * 86400000;
  const stale = new Set<number>();

  const segments = listSegments();
  const canonicalIds = new Set(segments.map((s) => canonicalSegmentId(s.id, s.reverseOf)));

  for (const canonId of canonicalIds) {
    const walkedAt = lastWalk.get(canonId);
    if (!walkedAt) {
      stale.add(canonId);
      continue;
    }
    if (Date.parse(walkedAt) < cutoff) stale.add(canonId);
  }

  // Routing uses directed segment ids — mark both directions stale when the path is stale.
  for (const s of segments) {
    const canon = canonicalSegmentId(s.id, s.reverseOf);
    if (stale.has(canon)) stale.add(s.id);
  }

  return stale;
}
