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

/** Sum preview totals for a user's walks, replaying global usage in walk order. */
export function sumPreviewPointsForUser(userId: number, weeklyOnly: boolean): number {
  let total = 0;
  const weekCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  replayAllWalkPreviews((row, preview) => {
    if (row.user_id === userId && (!weeklyOnly || row.accepted_at >= weekCutoff)) {
      total += preview.total;
    }
  });
  return total;
}

/** Preview breakdown per walk id for a user (usage replayed in walk order). */
export function getWalkPointPreviewsForUser(userId: number): Map<number, PointPreviewBreakdown> {
  const map = new Map<number, PointPreviewBreakdown>();
  replayAllWalkPreviews((row, preview) => {
    if (row.user_id === userId) map.set(row.id, preview);
  });
  return map;
}

type WalkLogReplayRow = {
  id: number;
  user_id: number;
  length_m: number;
  segment_ids: string;
  accepted_at: string;
};

function loadGoldenMultiplierMap(): Map<number, number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getGoldenMultiplierMap } = require("./goldenSegments") as typeof import("./goldenSegments");
  return getGoldenMultiplierMap();
}

function replayAllWalkPreviews(
  visitor: (row: WalkLogReplayRow, preview: PointPreviewBreakdown) => void,
): void {
  const goldenMap = loadGoldenMultiplierMap();
  const canonicalOf = buildCanonicalMap(listSegments());
  const usageMap = new Map<number, number>();
  const rows = db
    .prepare("SELECT id, user_id, length_m, segment_ids, accepted_at FROM walk_log ORDER BY accepted_at")
    .all() as WalkLogReplayRow[];

  for (const row of rows) {
    const segmentIds = JSON.parse(row.segment_ids) as number[];
    const preview = computeRoutePointPreview(segmentIds, row.length_m, usageMap, goldenMap, canonicalOf);
    visitor(row, preview);
    for (const id of segmentIds) {
      usageMap.set(id, (usageMap.get(id) ?? 0) + 1);
    }
  }
}

/** Points from completed walks: preview totals with streak multiplier. */
export function computeUserPoints(userId: number): UserPoints {
  const streak = getStreakStats(userId);
  const multiplier = streakMultiplier(streak.currentStreak);

  return {
    totalPoints: computeWalkPointsEarned({ base: 0, golden: 0, exploration: 0, diversity: 0, total: sumPreviewPointsForUser(userId, false) }, multiplier),
    weeklyPoints: computeWalkPointsEarned({ base: 0, golden: 0, exploration: 0, diversity: 0, total: sumPreviewPointsForUser(userId, true) }, multiplier),
    streakMultiplier: multiplier,
  };
}

export interface PointsLeaderboardEntry {
  userId: number;
  displayName: string;
  totalPoints: number;
}

/** All-time points leaderboard for the household. */
export function getPointsLeaderboard(limit = 20): PointsLeaderboardEntry[] {
  const users = db.prepare("SELECT id, display_name FROM users WHERE active = 1 AND deleted_at IS NULL").all() as {
    id: number;
    display_name: string;
  }[];

  return users
    .map((u) => {
      const streak = getStreakStats(u.id);
      const multiplier = streakMultiplier(streak.currentStreak);
      const previewTotal = sumPreviewPointsForUser(u.id, false);
      return {
        userId: u.id,
        displayName: u.display_name,
        totalPoints: computeWalkPointsEarned(
          { base: 0, golden: 0, exploration: 0, diversity: 0, total: previewTotal },
          multiplier,
        ),
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit);
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
  const unexplored = segmentIds.filter((id) => (usageMap.get(id) ?? 0) === 0).length;
  const exploration = unexplored * 8;
  const usageValues = [...usageMap.values()].sort((a, b) => a - b);
  const quartile =
    usageValues.length > 0 ? usageValues[Math.floor(usageValues.length * 0.25)] ?? 0 : 0;
  let diversity = 0;
  const seenDiverse = new Set<number>();
  for (const id of segmentIds) {
    const canon = canonicalOf.get(id) ?? id;
    if (seenDiverse.has(canon)) continue;
    seenDiverse.add(canon);
    if ((usageMap.get(id) ?? 0) <= quartile) diversity += 5;
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
  const seen = new Set<number>();
  let hits = 0;
  for (const id of segmentIds) {
    const canon = canonicalOf.get(id) ?? id;
    if (seen.has(canon)) continue;
    seen.add(canon);
    if (goldenMap.has(canon) || goldenMap.has(id)) hits++;
  }
  return hits;
}
