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

/** Per-profile totals. Segment counts treat a path and its reverse direction as one.
 * Home-access connectors count exactly like every other walked path (Phase L: the 0.41
 * exclusion from exploration totals was reverted — only generation scoring ignores them). */
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
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  nickname: string | null;
  acceptedAt: string;
  pointsEarned: number | null;
  pointsBase: number | null;
  pointsGolden: number | null;
  pointsExploration: number | null;
  pointsDiversity: number | null;
  streakMultiplier: number | null;
  celebrationTier: string | null;
  goldenHits: number | null;
  hasTrack: boolean;
}

export function getRecentWalks(userId: number, limit = 10): WalkLogEntry[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.node_chain, w.segment_ids, w.length_m, w.duration_min, w.nickname, w.accepted_at,
              w.points_earned, w.points_base, w.points_golden, w.points_exploration, w.points_diversity,
              w.streak_multiplier, w.celebration_tier, w.golden_hits,
              (w.track_json IS NOT NULL OR wt.walk_id IS NOT NULL) AS has_track
       FROM walk_log w
       LEFT JOIN walk_track wt ON wt.walk_id = w.id
       WHERE w.user_id = ? ORDER BY w.accepted_at DESC LIMIT ?`,
    )
    .all(userId, limit) as {
    id: number;
    node_chain: string;
    segment_ids: string;
    length_m: number;
    duration_min: number;
    nickname: string | null;
    accepted_at: string;
    points_earned: number | null;
    points_base: number | null;
    points_golden: number | null;
    points_exploration: number | null;
    points_diversity: number | null;
    streak_multiplier: number | null;
    celebration_tier: string | null;
    golden_hits: number | null;
    has_track: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    nodeChain: JSON.parse(r.node_chain) as number[],
    segmentIds: JSON.parse(r.segment_ids) as number[],
    lengthM: r.length_m,
    durationMin: r.duration_min,
    nickname: r.nickname,
    acceptedAt: r.accepted_at,
    pointsEarned: r.points_earned,
    pointsBase: r.points_base,
    pointsGolden: r.points_golden,
    pointsExploration: r.points_exploration,
    pointsDiversity: r.points_diversity,
    streakMultiplier: r.streak_multiplier,
    celebrationTier: r.celebration_tier,
    goldenHits: r.golden_hits,
    hasTrack: Boolean(r.has_track),
  }));
}

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  totalLengthM: number;
  walkCount: number;
}

/** Per-profile totals for confirmed walks in the last 7 days, longest distance first. */
export function getWeeklyLeaderboard(): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT w.user_id, u.display_name, SUM(w.length_m) AS total_m, COUNT(*) AS walks
       FROM walk_log w
       JOIN users u ON u.id = w.user_id
       WHERE w.accepted_at >= datetime('now', '-7 days')
       GROUP BY w.user_id
       ORDER BY total_m DESC`,
    )
    .all() as { user_id: number; display_name: string; total_m: number; walks: number }[];

  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    totalLengthM: r.total_m,
    walkCount: r.walks,
  }));
}

export interface SegmentUsageStat {
  segmentId: number;
  startNodeId: number;
  endNodeId: number;
  usageCount: number;
}

/** Network-wide usage per physical path (both directions combined).
 * Home-access connectors are ranked like every other path (Phase L revert). */
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
