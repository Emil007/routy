import { db } from "./db";
import { listSegments, type SegmentRow } from "./segments";
import { getStreakStats } from "./stats";

export interface UserPoints {
  totalPoints: number;
  weeklyPoints: number;
  streakMultiplier: number;
}

type WalkRow = { length_m: number; segment_ids: string };

export function streakMultiplier(currentStreak: number): number {
  if (currentStreak >= 30) return 2.0;
  if (currentStreak >= 14) return 1.5;
  if (currentStreak >= 7) return 1.25;
  if (currentStreak >= 3) return 1.1;
  return 1.0;
}

function canonicalSegmentId(s: Pick<SegmentRow, "id" | "reverseOf">): number {
  return s.reverseOf !== null ? Math.min(s.id, s.reverseOf) : s.id;
}

export { canonicalSegmentId };

function buildCanonicalMap(segments: SegmentRow[]): Map<number, number> {
  return new Map(segments.map((s) => [s.id, canonicalSegmentId(s)]));
}

/** Collapse directed usage counts onto canonical segment ids (BUG-6). */
export function toCanonicalUsageMap(
  usageMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, count] of usageMap) {
    const canon = canonicalOf.get(id) ?? id;
    out.set(canon, (out.get(canon) ?? 0) + count);
  }
  return out;
}

function elevationBonusForWalks(rows: WalkRow[]): number {
  let elevationBonus = 0;
  for (const row of rows) {
    const segmentIds = JSON.parse(row.segment_ids) as number[];
    if (segmentIds.length === 0) continue;
    const placeholders = segmentIds.map(() => "?").join(",");
    const segs = db
      .prepare(`SELECT COALESCE(ele_gain_m, 0) AS gain FROM segments WHERE id IN (${placeholders})`)
      .all(...segmentIds) as { gain: number }[];
    elevationBonus += segs.reduce((sum, s) => sum + s.gain, 0);
  }
  return elevationBonus;
}

function segmentsExploredFromWalks(rows: WalkRow[], canonicalOf: Map<number, number>): number {
  const explored = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.segment_ids) as number[]) {
      const canon = canonicalOf.get(id);
      if (canon !== undefined) explored.add(canon);
    }
  }
  return explored.size;
}

/** Shared base formula: walks + distance + elevation + exploration, before streak multiplier. */
export function computeBasePoints(rows: WalkRow[], canonicalOf?: Map<number, number>): number {
  const walkCount = rows.length;
  const totalLengthM = rows.reduce((sum, row) => sum + row.length_m, 0);
  const elevationBonus = elevationBonusForWalks(rows);
  const segmentMap = canonicalOf ?? buildCanonicalMap(listSegments());
  const segmentsExplored = segmentsExploredFromWalks(rows, segmentMap);
  return walkCount * 50 + Math.round(totalLengthM / 100) + Math.round(elevationBonus / 10) + segmentsExplored * 5;
}

/** Points for one completed walk: preview total × streak multiplier (matches generate preview). */
export function computeWalkPointsEarned(breakdown: PointPreviewBreakdown, streakMult: number): number {
  return Math.round(breakdown.total * streakMult);
}

/**
 * Streak length to use for the multiplier when completing a walk now.
 * First walk of the day extends the streak; later walks the same day keep the same multiplier.
 */
export function streakForPointsMultiplier(userId: number): number {
  const streak = getStreakStats(userId);
  const walkedToday = db
    .prepare("SELECT 1 FROM walk_log WHERE user_id = ? AND date(accepted_at) = date('now') LIMIT 1")
    .get(userId);
  if (walkedToday) return Math.max(1, streak.currentStreak);
  if (streak.currentStreak > 0) return streak.currentStreak + 1;
  return 1;
}

/** Ledger balances: SUM(points_earned) from walk_log (no replay × live streak). */
export function computeUserPoints(userId: number): UserPoints {
  const streak = getStreakStats(userId);
  const multiplier = streakMultiplier(streak.currentStreak);

  const totalRow = db
    .prepare("SELECT COALESCE(SUM(points_earned), 0) AS total FROM walk_log WHERE user_id = ?")
    .get(userId) as { total: number };
  const weeklyRow = db
    .prepare(
      `SELECT COALESCE(SUM(points_earned), 0) AS total FROM walk_log
       WHERE user_id = ? AND accepted_at >= datetime('now', '-7 days')`,
    )
    .get(userId) as { total: number };

  return {
    totalPoints: totalRow.total,
    weeklyPoints: weeklyRow.total,
    streakMultiplier: multiplier,
  };
}

export interface PointsLeaderboardEntry {
  userId: number;
  displayName: string;
  totalPoints: number;
}

/** All-time points leaderboard for the household (ledger sum). */
export function getPointsLeaderboard(limit = 20): PointsLeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.display_name, COALESCE(SUM(w.points_earned), 0) AS total
       FROM users u
       LEFT JOIN walk_log w ON w.user_id = u.id
       WHERE u.active = 1 AND u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY total DESC
       LIMIT ?`,
    )
    .all(limit) as { user_id: number; display_name: string; total: number }[];

  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    totalPoints: r.total,
  }));
}

export interface PointPreviewBreakdown {
  base: number;
  golden: number;
  exploration: number;
  diversity: number;
  total: number;
}

export type CelebrationTier = "normal" | "golden" | "streak" | "achievement";

/** Expected points for a route before streak multiplier (preview at generate time). */
export function computeRoutePointPreview(
  segmentIds: number[],
  lengthM: number,
  usageMap: Map<number, number>,
  goldenMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): PointPreviewBreakdown {
  const canonicalUsage = toCanonicalUsageMap(usageMap, canonicalOf);
  const base = Math.round(lengthM / 100) + 50;
  let golden = 0;
  const seenGolden = new Set<number>();
  for (const id of segmentIds) {
    const canon = canonicalOf.get(id) ?? id;
    if (seenGolden.has(canon)) continue;
    const mult = goldenMap.get(canon) ?? goldenMap.get(id);
    if (mult) {
      seenGolden.add(canon);
      golden += Math.round(base * 0.1 * (mult - 1));
    }
  }
  const routeCanons = [...new Set(segmentIds.map((id) => canonicalOf.get(id) ?? id))];
  const unexplored = routeCanons.filter((c) => (canonicalUsage.get(c) ?? 0) === 0).length;
  const exploration = unexplored * 8;
  const usageValues = [...canonicalUsage.values()].sort((a, b) => a - b);
  const quartile =
    usageValues.length > 0 ? usageValues[Math.floor(usageValues.length * 0.25)] ?? 0 : 0;
  let diversity = 0;
  for (const canon of routeCanons) {
    if ((canonicalUsage.get(canon) ?? 0) <= quartile) diversity += 5;
  }
  const total = base + golden + exploration + diversity;
  return { base, golden, exploration, diversity, total };
}

export function celebrationTierForWalk(
  goldenHits: number,
  currentStreak: number,
  pointsEarned: number,
): CelebrationTier {
  if (goldenHits >= 2) return "golden";
  if (currentStreak >= 7) return "streak";
  if (pointsEarned >= 150) return "achievement";
  return "normal";
}

export function countGoldenHits(segmentIds: number[], goldenMap: Map<number, number>, canonicalOf: Map<number, number>): number {
  return goldenHitCanonicalIds(segmentIds, goldenMap, canonicalOf).length;
}

/** Canonical golden segment ids that appear on the route (direction-aware). */
export function goldenHitCanonicalIds(
  segmentIds: number[],
  goldenMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): number[] {
  const seen = new Set<number>();
  const hits: number[] = [];
  for (const id of segmentIds) {
    const canon = canonicalOf.get(id) ?? id;
    if (seen.has(canon)) continue;
    seen.add(canon);
    if (goldenMap.has(canon) || goldenMap.has(id)) hits.push(canon);
  }
  return hits;
}
