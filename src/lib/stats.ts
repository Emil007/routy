import { db } from "./db";
import { listSegments, getUsageMap, type SegmentRow } from "./segments";

function canonicalSegmentId(s: Pick<SegmentRow, "id" | "reverseOf">): number {
  return s.reverseOf !== null ? Math.min(s.id, s.reverseOf) : s.id;
}

export interface UserStats {
  walkCount: number;
  totalLengthM: number;
  totalDurationMin: number;
  segmentsExplored: number;
  totalSegments: number;
}

/** Per-profile totals. Segment counts treat a path and its reverse direction as one. */
export function getUserStats(userId: number): UserStats {
  const rows = db
    .prepare("SELECT length_m, duration_min, segment_ids FROM walk_log WHERE user_id = ?")
    .all(userId) as { length_m: number; duration_min: number; segment_ids: string }[];

  let totalLengthM = 0;
  let totalDurationMin = 0;
  const usedSegmentIds = new Set<number>();
  for (const row of rows) {
    totalLengthM += row.length_m;
    totalDurationMin += row.duration_min;
    for (const id of JSON.parse(row.segment_ids) as number[]) usedSegmentIds.add(id);
  }

  const segments = listSegments();
  const canonicalOf = new Map<number, number>(segments.map((s) => [s.id, canonicalSegmentId(s)]));
  const explored = new Set<number>();
  for (const id of usedSegmentIds) {
    const canon = canonicalOf.get(id);
    if (canon !== undefined) explored.add(canon);
  }
  const totalSegments = new Set(segments.map(canonicalSegmentId)).size;

  return {
    walkCount: rows.length,
    totalLengthM,
    totalDurationMin,
    segmentsExplored: explored.size,
    totalSegments,
  };
}

export interface WalkLogEntry {
  id: number;
  nodeChain: number[];
  lengthM: number;
  durationMin: number;
  acceptedAt: string;
}

export function getRecentWalks(userId: number, limit = 10): WalkLogEntry[] {
  const rows = db
    .prepare(
      "SELECT id, node_chain, length_m, duration_min, accepted_at FROM walk_log WHERE user_id = ? ORDER BY accepted_at DESC LIMIT ?",
    )
    .all(userId, limit) as {
    id: number;
    node_chain: string;
    length_m: number;
    duration_min: number;
    accepted_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    nodeChain: JSON.parse(r.node_chain) as number[],
    lengthM: r.length_m,
    durationMin: r.duration_min,
    acceptedAt: r.accepted_at,
  }));
}

export interface SegmentUsageStat {
  segmentId: number;
  startNodeId: number;
  endNodeId: number;
  usageCount: number;
}

/** Network-wide usage per physical path (both directions combined). */
export function getSegmentUsageStats(): SegmentUsageStat[] {
  const segments = listSegments();
  const usage = getUsageMap();
  const byCanon = new Map<number, { representative: SegmentRow; total: number }>();

  for (const s of segments) {
    const canon = canonicalSegmentId(s);
    const u = usage.get(s.id) ?? 0;
    const entry = byCanon.get(canon);
    if (!entry) {
      byCanon.set(canon, { representative: s, total: u });
    } else {
      entry.total += u;
      if (s.id === canon) entry.representative = s;
    }
  }

  return [...byCanon.values()].map(({ representative, total }) => ({
    segmentId: representative.id,
    startNodeId: representative.startNodeId,
    endNodeId: representative.endNodeId,
    usageCount: total,
  }));
}
