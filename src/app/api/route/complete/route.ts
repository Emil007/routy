import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute, clearActiveRoute } from "@/lib/activeRoute";
import {
  computeWalkPointsEarned,
  streakMultiplier,
  computeRoutePointPreview,
  celebrationTierForWalk,
  countGoldenHits,
  canonicalSegmentId,
} from "@/lib/points";
import { recordWalk, getUsageMap, listSegments } from "@/lib/segments";
import { getStreakStats } from "@/lib/stats";
import { logActivity } from "@/lib/activityLog";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  const streak = getStreakStats(user.id);
  const multiplier = streakMultiplier(streak.currentStreak);

  // Compute payout from the same preview formula shown at generate time (usage before this walk).
  const usageMap = getUsageMap();
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const breakdown = computeRoutePointPreview(active.segmentIds, active.lengthM, usageMap, goldenMap, canonicalOf);
  const pointsEarned = computeWalkPointsEarned(breakdown, multiplier);
  const goldenHits = countGoldenHits(active.segmentIds, goldenMap, canonicalOf);
  const celebrationTier = celebrationTierForWalk(goldenHits, streak.currentStreak, pointsEarned);

  recordWalk(user.id, active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, active.nickname);
  logActivity(user.id, "walk_complete", "walk", null, {
    nickname: active.nickname,
    lengthM: active.lengthM,
    durationMin: active.durationMin,
  });
  clearActiveRoute(user.id);

  return NextResponse.json({
    success: true,
    pointsEarned,
    streakMultiplier: multiplier,
    currentStreak: streak.currentStreak,
    pointBreakdown: breakdown,
    goldenHits,
    celebrationTier,
  });
}
