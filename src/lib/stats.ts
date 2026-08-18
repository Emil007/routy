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

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
}

/** Consecutive calendar days (UTC) with at least one confirmed walk. */
export function getStreakStats(userId: number): StreakStats {
  const rows = db
    .prepare("SELECT DISTINCT date(accepted_at) AS d FROM walk_log WHERE user_id = ? ORDER BY d")
    .all(userId) as { d: string }[];
  const dates = rows.map((r) => r.d);
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const DAY_MS = 86400000;
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(dates[i - 1] + "T00:00:00Z");
    const curr = Date.parse(dates[i] + "T00:00:00Z");
    run = curr - prev === DAY_MS ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const lastDate = Date.parse(dates[dates.length - 1] + "T00:00:00Z");
  const daysSinceLast = Math.round((todayUTC.getTime() - lastDate) / DAY_MS);

  let currentStreak = 0;
  if (daysSinceLast <= 1) {
    currentStreak = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      const prev = Date.parse(dates[i - 1] + "T00:00:00Z");
      const curr = Date.parse(dates[i] + "T00:00:00Z");
      if (curr - prev === DAY_MS) currentStreak++;
      else break;
    }
  }

  return { currentStreak, longestStreak };
}

/** How many times this user has walked each physical (canonical) segment. */
export function getUserSegmentWalkCounts(userId: number): Map<number, number> {
  const rows = db.prepare("SELECT segment_ids FROM walk_log WHERE user_id = ?").all(userId) as {
    segment_ids: string;
  }[];
  const segments = listSegments();
  const canonicalOf = new Map<number, number>(segments.map((s) => [s.id, canonicalSegmentId(s)]));

  const counts = new Map<number, number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.segment_ids) as number[]) {
      const canon = canonicalOf.get(id);
      if (canon === undefined) continue;
      counts.set(canon, (counts.get(canon) ?? 0) + 1);
    }
  }
  return counts;
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
