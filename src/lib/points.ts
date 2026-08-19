import { db } from "./db";
import { listSegments, type SegmentRow } from "./segments";
import { getStreakStats } from "./stats";

export interface UserPoints {
  totalPoints: number;
  weeklyPoints: number;
  streakMultiplier: number;
}

type WalkRow = { length_m: number; segment_ids: string };

function streakMultiplier(currentStreak: number): number {
  if (currentStreak >= 30) return 2.0;
  if (currentStreak >= 14) return 1.5;
  if (currentStreak >= 7) return 1.25;
  if (currentStreak >= 3) return 1.1;
  return 1.0;
}

function canonicalSegmentId(s: Pick<SegmentRow, "id" | "reverseOf">): number {
  return s.reverseOf !== null ? Math.min(s.id, s.reverseOf) : s.id;
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

function segmentsExploredFromWalks(rows: WalkRow[]): number {
  const segments = listSegments();
  const canonicalOf = new Map<number, number>(segments.map((s) => [s.id, canonicalSegmentId(s)]));
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
export function computeBasePoints(rows: WalkRow[]): number {
  const walkCount = rows.length;
  const totalLengthM = rows.reduce((sum, row) => sum + row.length_m, 0);
  const elevationBonus = elevationBonusForWalks(rows);
  const segmentsExplored = segmentsExploredFromWalks(rows);
  return walkCount * 50 + Math.round(totalLengthM / 100) + Math.round(elevationBonus / 10) + segmentsExplored * 5;
}

/** Points from completed walks: distance, elevation gain, completion bonus, streak multiplier. */
export function computeUserPoints(userId: number): UserPoints {
  const streak = getStreakStats(userId);
  const multiplier = streakMultiplier(streak.currentStreak);

  const allRows = db
    .prepare("SELECT length_m, segment_ids FROM walk_log WHERE user_id = ?")
    .all(userId) as WalkRow[];

  const weeklyRows = db
    .prepare(
      `SELECT length_m, segment_ids FROM walk_log
       WHERE user_id = ? AND accepted_at >= datetime('now', '-7 days')`,
    )
    .all(userId) as WalkRow[];

  return {
    totalPoints: Math.round(computeBasePoints(allRows) * multiplier),
    weeklyPoints: Math.round(computeBasePoints(weeklyRows) * multiplier),
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

  const walkRows = db
    .prepare("SELECT user_id, length_m, segment_ids FROM walk_log")
    .all() as { user_id: number; length_m: number; segment_ids: string }[];

  const walksByUser = new Map<number, WalkRow[]>();
  for (const row of walkRows) {
    const list = walksByUser.get(row.user_id) ?? [];
    list.push({ length_m: row.length_m, segment_ids: row.segment_ids });
    walksByUser.set(row.user_id, list);
  }

  return users
    .map((u) => {
      const streak = getStreakStats(u.id);
      const multiplier = streakMultiplier(streak.currentStreak);
      const rows = walksByUser.get(u.id) ?? [];
      return {
        userId: u.id,
        displayName: u.display_name,
        totalPoints: Math.round(computeBasePoints(rows) * multiplier),
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit);
}
