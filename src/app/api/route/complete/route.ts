import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute, clearActiveRoute } from "@/lib/activeRoute";
import { computeUserPoints } from "@/lib/points";
import { recordWalk } from "@/lib/segments";
import { getStreakStats } from "@/lib/stats";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  const before = computeUserPoints(user.id);
  recordWalk(user.id, active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, active.nickname);
  clearActiveRoute(user.id);
  const after = computeUserPoints(user.id);
  const streak = getStreakStats(user.id);

  return NextResponse.json({
    success: true,
    pointsEarned: after.totalPoints - before.totalPoints,
    streakMultiplier: after.streakMultiplier,
    currentStreak: streak.currentStreak,
  });
}
