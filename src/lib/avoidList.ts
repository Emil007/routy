import { db } from "./db";
import { directedPairIds, getSegment } from "./segments";

export interface AvoidEntry {
  segmentId: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Per-user soft-avoid segment IDs — routing penalizes but does not exclude. */
export function listAvoidSegmentIds(userId: number): number[] {
  purgeExpiredAvoids(userId);
  const rows = db
    .prepare(
      `SELECT segment_id FROM user_avoid_segment
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY segment_id`,
    )
    .all(userId) as { segment_id: number }[];
  return rows.map((r) => r.segment_id);
}

export function listAvoidEntries(userId: number): AvoidEntry[] {
  purgeExpiredAvoids(userId);
  const rows = db
    .prepare(
      `SELECT segment_id, reason, expires_at, created_at FROM user_avoid_segment
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY segment_id`,
    )
    .all(userId) as { segment_id: number; reason: string | null; expires_at: string | null; created_at: string }[];
  return rows.map((r) => ({
    segmentId: r.segment_id,
    reason: r.reason,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

function purgeExpiredAvoids(userId: number): void {
  db.prepare(
    "DELETE FROM user_avoid_segment WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= datetime('now')",
  ).run(userId);
}

export function getAvoidSegmentSet(userId: number): Set<number> {
  const set = new Set<number>();
  for (const id of listAvoidSegmentIds(userId)) {
    for (const directed of directedPairIds(id)) set.add(directed);
  }
  return set;
}

export function addAvoidSegment(
  userId: number,
  segmentId: number,
  options?: { reason?: string | null; days?: number | null },
): boolean {
  const segment = getSegment(segmentId);
  if (!segment) return false;
  const expiresAt =
    options?.days && options.days > 0
      ? new Date(Date.now() + options.days * 86400000).toISOString()
      : null;
  const reason = options?.reason?.trim() || null;
  const upsert = db.prepare(
    `INSERT INTO user_avoid_segment (user_id, segment_id, reason, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, segment_id) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at`,
  );
  for (const id of directedPairIds(segmentId)) {
    upsert.run(userId, id, reason, expiresAt);
  }
  return true;
}

export function removeAvoidSegment(userId: number, segmentId: number): void {
  const del = db.prepare("DELETE FROM user_avoid_segment WHERE user_id = ? AND segment_id = ?");
  for (const id of directedPairIds(segmentId)) {
    del.run(userId, id);
  }
}

export function isSegmentAvoidedByUser(userId: number, segmentId: number): boolean {
  const ids = directedPairIds(segmentId);
  const placeholders = ids.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT 1 FROM user_avoid_segment WHERE user_id = ? AND segment_id IN (${placeholders})
       AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`,
    )
    .get(userId, ...ids);
  return !!row;
}
