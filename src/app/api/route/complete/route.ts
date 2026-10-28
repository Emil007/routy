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
  GUIDE_POINTS_MULTIPLIER,
} from "@/lib/points";
import { recordWalkWithPoints, getUsageMap, listSegments, lengthFromSegmentIds } from "@/lib/segments";
import { getStreakStats } from "@/lib/stats";
import { logActivity } from "@/lib/activityLog";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { parseSqliteIso } from "@/lib/timezone";
import { checkApiRateLimit } from "@/lib/apiRateLimit";
import { persistHopTimingsFromWalk, enqueueWalkGeometryAnalysis } from "@/lib/trackGeometry";
import { persistAchievements } from "@/lib/achievements";
import { type Locale } from "@/lib/i18n";

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
    trackPoints: z.array(trackPointSchema).max(10_000).optional(),
    durationMin: z.number().int().nonnegative().max(24 * 60 * 7).optional(),
  })
  .optional();

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rate = checkApiRateLimit("route_complete", { userId: user.id });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
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

  const usageMap = getUsageMap(user.id);
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const guideMode = active.walkMode === "guide";
  const goldenHits = countGoldenHits(active.segmentIds, goldenMap, canonicalOf);

  // F02/M1-2: points must come from the REAL segment lengths, not a length any
  // client supplied (directly or via active_route.length_m). Recompute from the
  // segment table before crediting; if any id is stale, refuse instead of
  // paying points on a broken route.
  const realLength = lengthFromSegmentIds(active.segmentIds);
  if (realLength === null) {
    return NextResponse.json({ error: "route_stale" }, { status: 409 });
  }
  const breakdownReal = computeRoutePointPreview(active.segmentIds, realLength, usageMap, goldenMap, canonicalOf);
  const pointsEarnedReal = computeWalkPointsEarned(breakdownReal, multiplier, guideMode);
  const celebrationTier = celebrationTierForWalk(goldenHits, streakForMult, pointsEarnedReal);

  // M1-4: duration is the actual walk duration. Use the body value when present
  // and in-schema (0…7 days int); otherwise elapsed minutes since accepted_at,
  // floored at 1. Never the planned route duration as fact.
  // M29: accepted_at ist SQLite-UTC ohne Zone — als UTC parsen, nicht als Host-Lokalzeit.
  const durationMin =
    parsed.data?.durationMin != null
      ? Math.round(parsed.data.durationMin)
      : Math.max(
          1,
          Math.floor((Date.now() - (parseSqliteIso(active.acceptedAt)?.getTime() ?? NaN)) / 60000) || 1,
        );

  const walkId = recordWalkWithPoints(
    user.id,
    active.nodeChain,
    active.segmentIds,
    realLength,
    durationMin,
    active.nickname,
    {
      pointsEarned: pointsEarnedReal,
      pointsBase: breakdownReal.base,
      pointsGolden: breakdownReal.golden,
      pointsExploration: breakdownReal.exploration,
      pointsDiversity: breakdownReal.diversity,
      streakMultiplier: multiplier,
      celebrationTier,
      goldenHits,
    },
    { claimActiveRoute: true },
  );

  if (walkId === null) {
    return NextResponse.json({ error: "no_active_route" }, { status: 404 });
  }

  // M1-4: once the walk_log row is committed, the walk is booked — everything
  // after is best-effort bookkeeping and must never surface a 500 that makes
  // clients retry and double-book.
  try {
    if (trackPoints && trackPoints.length > 0) {
      const pointsJson = JSON.stringify(trackPoints);
      // Single source of truth: walk_track.points_json. walk_log.track_json stays
      // as a legacy column (old rows, schema compatibility) but is no longer
      // written — every reader prefers walk_track and falls back cleanly.
      db.prepare(
        `INSERT INTO walk_track (walk_id, points_json) VALUES (?, ?)
         ON CONFLICT(walk_id) DO UPDATE SET points_json = excluded.points_json`,
      ).run(walkId, pointsJson);
      // F04: only the owning walker or an admin may retime another profile's
      // segment; the speed band is enforced inside applyGpsHopDurationIfMissing.
      persistHopTimingsFromWalk(walkId, { walkUserId: user.id, walkerIsAdmin: user.role === "admin" });
      // 0.57: GPS-Aufnahme sofort zur persistenten Segment-Analyse anmelden
      // (einmalig rechnen, danach aus der DB lesen — kein O(n²) mehr pro Aufruf).
      enqueueWalkGeometryAnalysis(walkId);
    }
  } catch (err) {
    console.error("track/hop persistence failed (walk already booked):", err);
  }

  logActivity(user.id, "walk_complete", "walk", walkId, {
    nickname: active.nickname,
    lengthM: realLength,
    durationMin,
    pointsEarned: pointsEarnedReal,
  });

  try {
    // Decision E: persist earned achievements so weekWarrior/collector can't regress.
    persistAchievements(user.id, user.locale as Locale);
  } catch (err) {
    console.error("persistAchievements failed (walk already credited):", err);
  }

  const streak = getStreakStats(user.id);

  return NextResponse.json({
    success: true,
    walkId,
    pointsEarned: pointsEarnedReal,
    streakMultiplier: multiplier,
    currentStreak: streak.currentStreak,
    pointBreakdown: breakdownReal,
    goldenHits,
    celebrationTier,
    guideMode,
    pointsMultiplier: guideMode ? GUIDE_POINTS_MULTIPLIER : 1,
  });
}
