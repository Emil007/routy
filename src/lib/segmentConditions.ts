import { db } from "./db";
import { canonicalSegmentId, directedPairIds, getSegment } from "./segments";

export const CONDITION_REASONS = ["muddy", "flooded", "construction", "dog", "icy", "overgrown"] as const;
export type ConditionReason = (typeof CONDITION_REASONS)[number];

export const DEFAULT_CONDITION_DAYS = 7;
export const MAX_ACTIVE_CONDITIONS_PER_PATH = 5;

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

/** Per directed segment id: active condition report count (mirrored across path pair). */
export function getConditionPenaltyMap(): Map<number, number> {
  const byCanon = new Map<number, number>();
  for (const c of listActiveConditions()) {
    const segment = getSegment(c.segmentId);
    const canon = segment ? canonicalSegmentId(segment) : c.segmentId;
    byCanon.set(canon, (byCanon.get(canon) ?? 0) + 1);
  }
  const map = new Map<number, number>();
  for (const [canon, count] of byCanon) {
    for (const id of directedPairIds(canon)) {
      map.set(id, count);
    }
  }
  return map;
}

export function listActiveConditionsForSegment(segmentId: number): SegmentConditionRow[] {
  const segment = getSegment(segmentId);
  if (!segment) return [];
  const canon = canonicalSegmentId(segment);
  return listActiveConditions().filter((c) => {
    const s = getSegment(c.segmentId);
    return s !== null && canonicalSegmentId(s) === canon;
  });
}

function activeOnPath(canonId: number): SegmentConditionRow[] {
  return listActiveConditions().filter((c) => {
    const s = getSegment(c.segmentId);
    return s !== null && canonicalSegmentId(s) === canonId;
  });
}

export function reportCondition(
  segmentId: number,
  reason: ConditionReason,
  reportedBy: number,
  days = DEFAULT_CONDITION_DAYS,
): SegmentConditionRow | null {
  purgeExpiredConditions();
  const segment = getSegment(segmentId);
  if (!segment || segment.deletedAt) return null;

  const canon = canonicalSegmentId(segment);
  const active = activeOnPath(canon);
  const existing = active.find((c) => c.reportedBy === reportedBy && c.reason === reason);
  if (existing) return existing;
  if (active.length >= MAX_ACTIVE_CONDITIONS_PER_PATH) return null;

  const result = db
    .prepare(
      "INSERT INTO segment_condition (segment_id, reason, reported_by, expires_at, created_at) VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'), datetime('now'))",
    )
    .run(segmentId, reason, reportedBy, days);
  const row = db
    .prepare(
      "SELECT id, segment_id, reason, reported_by, expires_at, created_at FROM segment_condition WHERE id = ?",
    )
    .get(Number(result.lastInsertRowid)) as {
    id: number;
    segment_id: number;
    reason: string;
    reported_by: number;
    expires_at: string;
    created_at: string;
  };
  return rowFromDb(row);
}
