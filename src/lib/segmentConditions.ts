import { db } from "./db";
import { getSegment } from "./segments";

export const CONDITION_REASONS = ["muddy", "flooded", "construction", "dog", "icy", "overgrown"] as const;
export type ConditionReason = (typeof CONDITION_REASONS)[number];

export const DEFAULT_CONDITION_DAYS = 7;

export interface SegmentConditionRow {
  id: number;
  segmentId: number;
  reason: ConditionReason;
  reportedBy: number;
  expiresAt: string;
  createdAt: string;
}

function rowFromDb(r: {
  id: number;
  segment_id: number;
  reason: string;
  reported_by: number;
  expires_at: string;
  created_at: string;
}): SegmentConditionRow {
  return {
    id: r.id,
    segmentId: r.segment_id,
    reason: r.reason as ConditionReason,
    reportedBy: r.reported_by,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

export function purgeExpiredConditions(): number {
  const result = db.prepare("DELETE FROM segment_condition WHERE expires_at < datetime('now')").run();
  return result.changes;
}

export function listActiveConditions(): SegmentConditionRow[] {
  purgeExpiredConditions();
  const rows = db
    .prepare(
      "SELECT id, segment_id, reason, reported_by, expires_at, created_at FROM segment_condition WHERE expires_at >= datetime('now') ORDER BY segment_id, id",
    )
    .all() as {
    id: number;
    segment_id: number;
    reason: string;
    reported_by: number;
    expires_at: string;
    created_at: string;
  }[];
  return rows.map(rowFromDb);
}

/** Per segment: number of active condition reports (for routing penalty weighting). */
export function getConditionPenaltyMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of listActiveConditions()) {
    map.set(c.segmentId, (map.get(c.segmentId) ?? 0) + 1);
  }
  return map;
}

export function listActiveConditionsForSegment(segmentId: number): SegmentConditionRow[] {
  return listActiveConditions().filter((c) => c.segmentId === segmentId);
}

export function reportCondition(
  segmentId: number,
  reason: ConditionReason,
  reportedBy: number,
  days = DEFAULT_CONDITION_DAYS,
): SegmentConditionRow | null {
  const segment = getSegment(segmentId);
  if (!segment || segment.deletedAt) return null;
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const result = db
    .prepare(
      "INSERT INTO segment_condition (segment_id, reason, reported_by, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(segmentId, reason, reportedBy, expiresAt);
  return {
    id: Number(result.lastInsertRowid),
    segmentId,
    reason,
    reportedBy,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
}
