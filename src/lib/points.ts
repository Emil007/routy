import { db } from "./db";
import { getUserStats, getStreakStats } from "./stats";

export interface UserPoints {
  totalPoints: number;
  weeklyPoints: number;
  streakMultiplier: number;
}

function streakMultiplier(currentStreak: number): number {
  if (currentStreak >= 30) return 2.0;
  if (currentStreak >= 14) return 1.5;
  if (currentStreak >= 7) return 1.25;
  if (currentStreak >= 3) return 1.1;
  return 1.0;
}

/** Points from completed walks: distance, elevation gain, completion bonus, streak multiplier. */
export function computeUserPoints(userId: number): UserPoints {
  const stats = getUserStats(userId);
  const streak = getStreakStats(userId);
  const multiplier = streakMultiplier(streak.currentStreak);

  const rows = db
    .prepare("SELECT length_m, segment_ids FROM walk_log WHERE user_id = ?")
    .all(userId) as { length_m: number; segment_ids: string }[];

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

  const base =
    stats.walkCount * 50 +
    Math.round(stats.totalLengthM / 100) +
    Math.round(elevationBonus / 10) +
    stats.segmentsExplored * 5;

  const totalPoints = Math.round(base * multiplier);

  const weeklyRow = db
    .prepare(
      `SELECT COALESCE(SUM(length_m), 0) AS total_m, COUNT(*) AS walks
       FROM walk_log WHERE user_id = ? AND accepted_at >= datetime('now', '-7 days')`,
    )
    .get(userId) as { total_m: number; walks: number };

  const weeklyBase = weeklyRow.walks * 50 + Math.round(weeklyRow.total_m / 100);
  const weeklyPoints = Math.round(weeklyBase * multiplier);

  return { totalPoints, weeklyPoints, streakMultiplier: multiplier };
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
    .map((u) => ({
      userId: u.id,
      displayName: u.display_name,
      totalPoints: computeUserPoints(u.id).totalPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit);
}
