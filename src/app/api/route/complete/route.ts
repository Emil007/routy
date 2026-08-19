import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute, clearActiveRoute } from "@/lib/activeRoute";
import { computeBasePoints, streakMultiplier } from "@/lib/points";
import { recordWalk } from "@/lib/segments";
import { getStreakStats } from "@/lib/stats";
import { logActivity } from "@/lib/activityLog";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  recordWalk(user.id, active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, active.nickname);
  logActivity(user.id, "walk_complete", "walk", null, {
    nickname: active.nickname,
    lengthM: active.lengthM,
    durationMin: active.durationMin,
  });
  clearActiveRoute(user.id);
  const streak = getStreakStats(user.id);
  const multiplier = streakMultiplier(streak.currentStreak);
  const walkBase = computeBasePoints([
    { length_m: active.lengthM, segment_ids: JSON.stringify(active.segmentIds) },
  ]);

  return NextResponse.json({
    success: true,
    pointsEarned: Math.round(walkBase * multiplier),
    streakMultiplier: multiplier,
    currentStreak: streak.currentStreak,
  });
}
