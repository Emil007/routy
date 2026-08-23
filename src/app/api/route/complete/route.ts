import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute } from "@/lib/activeRoute";
import { db } from "@/lib/db";
import {
  computeWalkPointsEarned,
  streakMultiplier,
  computeRoutePointPreview,
  celebrationTierForWalk,
  countGoldenHits,
  canonicalSegmentId,
  streakForPointsMultiplier,
} from "@/lib/points";
import { recordWalkWithPoints, getUsageMap, listSegments } from "@/lib/segments";
import { getStreakStats } from "@/lib/stats";
import { logActivity } from "@/lib/activityLog";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { checkApiRateLimit } from "@/lib/apiRateLimit";
import { persistHopTimingsFromWalk } from "@/lib/trackGeometry";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";

const trackPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  ele: z.number().optional(),
  time: z.string().optional(),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  bearing: z.number().optional(),
});

const bodySchema = z
  .object({
    trackPoints: z.array(trackPointSchema).optional(),
  })
  .optional();

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rate = checkApiRateLimit("route_complete", { userId: user.id });
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const trackPoints = parsed.data?.trackPoints;

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  const streakForMult = streakForPointsMultiplier(user.id);
  const multiplier = streakMultiplier(streakForMult);

  const usageMap = getUsageMap();
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const breakdown = computeRoutePointPreview(active.segmentIds, active.lengthM, usageMap, goldenMap, canonicalOf);
  const pointsEarned = computeWalkPointsEarned(breakdown, multiplier);
  const goldenHits = countGoldenHits(active.segmentIds, goldenMap, canonicalOf);
  const celebrationTier = celebrationTierForWalk(goldenHits, streakForMult, pointsEarned);

  const walkId = recordWalkWithPoints(
    user.id,
    active.nodeChain,
    active.segmentIds,
    active.lengthM,
    active.durationMin,
    active.nickname,
    {
      pointsEarned,
      pointsBase: breakdown.base,
      pointsGolden: breakdown.golden,
      pointsExploration: breakdown.exploration,
      pointsDiversity: breakdown.diversity,
      streakMultiplier: multiplier,
      celebrationTier,
      goldenHits,
    },
    { claimActiveRoute: true },
  );

  if (walkId === null) {
    return NextResponse.json({ error: "no_active_route" }, { status: 404 });
  }

  if (trackPoints && trackPoints.length > 0) {
    const pointsJson = JSON.stringify(trackPoints);
    db.prepare(
      `INSERT INTO walk_track (walk_id, points_json) VALUES (?, ?)
       ON CONFLICT(walk_id) DO UPDATE SET points_json = excluded.points_json`,
    ).run(walkId, pointsJson);
    db.prepare("UPDATE walk_log SET track_json = ? WHERE id = ?").run(pointsJson, walkId);
    const settings = getSettings();
    persistHopTimingsFromWalk(walkId, effectiveWalkSpeedKmh(user.walkSpeedKmh, settings));
  }

  logActivity(user.id, "walk_complete", "walk", walkId, {
    nickname: active.nickname,
    lengthM: active.lengthM,
    durationMin: active.durationMin,
    pointsEarned,
  });

  const streak = getStreakStats(user.id);

  return NextResponse.json({
    success: true,
    walkId,
    pointsEarned,
    streakMultiplier: multiplier,
    currentStreak: streak.currentStreak,
    pointBreakdown: breakdown,
    goldenHits,
    celebrationTier,
  });
}
