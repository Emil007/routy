import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getStreakStats } from "@/lib/stats";
import { db } from "@/lib/db";
import { assertFreeRoamOwner, matchTrackToNetwork, completedWalkIdFor } from "@/lib/freeRoam";
import {
  listSegments,
  recordWalkWithPoints,
  getUsageMap,
  canonicalSegmentId,
} from "@/lib/segments";
import {
  computeWalkPointsEarned,
  streakMultiplier,
  computeRoutePointPreview,
  celebrationTierForWalk,
  countGoldenHits,
  streakForPointsMultiplier,
  FREE_ROAM_POINTS_MULTIPLIER,
} from "@/lib/points";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { logActivity } from "@/lib/activityLog";
import { checkApiRateLimit } from "@/lib/apiRateLimit";
import { detectProposalsFromTrack } from "@/lib/discovery";
import { persistHopTimingsFromWalk } from "@/lib/trackGeometry";
import { pathLengthMeters, haversineMeters } from "@/lib/geo";
import { persistAchievements } from "@/lib/achievements";
import { type Locale } from "@/lib/i18n";

// Q10 (decided 2026-10-28): free-roam bounds.
export const FREE_ROAM_MAX_TOTAL_M = 80_000;
export const FREE_ROAM_MAX_DURATION_MIN = 18 * 60;
export const FREE_ROAM_MAX_HOP_M = 500;
export const FREE_ROAM_MAX_HOP_SPEED_KMH = 20;
export const FREE_ROAM_MIN_TRACK_M = 50;

const trackPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  ele: z.number().optional(),
  time: z.string().optional(),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  bearing: z.number().optional(),
});

const bodySchema = z.object({
  token: z.string().min(1),
  trackPoints: z.array(trackPointSchema).min(2).max(10_000),
  // Kept for backwards compatibility with older clients, but IGNORED: length is
  // recomputed server-side from trackPoints (deep-review #1, spoof guard).
  lengthM: z.number().int().nonnegative().optional(),
  // Kept for backwards compatibility with older clients, but IGNORED (M1-6/Q10):
  // duration is derived from the session startedAt, not the client-supplied value.
  durationMin: z.number().int().nonnegative().max(24 * 60 * 7).optional(),
  nickname: z.string().trim().max(120).optional().nullable(),
});

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
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const { token, trackPoints, nickname } = parsed.data;

  const access = assertFreeRoamOwner(token, user.id);
  if (access === "missing") return NextResponse.json({ error: "session_expired" }, { status: 410 });
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Anti-replay (decision K + security review): the stateless HMAC token has no
  // server-side "spent" flag, so a completed token must not be redeemable again.
  // The tombstone is keyed by (userId, startedAt) — the session's immutable id
  // shared by every rotated token. Written atomically with the walk row inside
  // recordWalkWithPoints. If a retry arrives after the response was lost, the
  // SAME already-credited walk is returned instead of double-booking.
  const alreadyDone = completedWalkIdFor(access);
  if (alreadyDone != null) {
    return NextResponse.json({
      success: true,
      walkId: alreadyDone,
      freeRoam: true,
      alreadyCredited: true,
    });
  }

  const { nodeChain, segmentIds } = matchTrackToNetwork(trackPoints);

  // Server-side length (deep-review #1, critical): points must NOT be awarded
  // from a client-supplied lengthM — that was an open spoof (tiny track + huge
  // lengthM = arbitrary points even at the 0.5 multiplier). Recompute the walked
  // distance from the submitted trackPoints, so it can't be inflated.
  const lengthM = Math.round(pathLengthMeters(trackPoints));

  // Q10 validation (M1-6): coordinate sanity, hop speed caps, total distance and
  // duration caps before anything is booked. Only after they pass we look at
  // minimum distance.
  for (const p of trackPoints) {
    if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
      return NextResponse.json({ error: "invalid_coordinates" }, { status: 400 });
    }
  }
  for (let i = 1; i < trackPoints.length; i++) {
    const a = trackPoints[i - 1]!;
    const b = trackPoints[i]!;
    const hopM = haversineMeters(a, b);
    const dtHours = (() => {
      const ta = a.time ? Date.parse(a.time) : NaN;
      const tb = b.time ? Date.parse(b.time) : NaN;
      if (Number.isNaN(ta) || Number.isNaN(tb)) return 1 / 60; // no timestamps → worst case
      return Math.max(0, (tb - ta) / 3_600_000) + 1 / 60;
    })();
    const hopCapM = Math.max(FREE_ROAM_MAX_HOP_M, FREE_ROAM_MAX_HOP_SPEED_KMH * 1000 * dtHours);
    if (hopM > hopCapM) {
      return NextResponse.json({ error: "hop_too_far" }, { status: 422 });
    }
  }
  if (lengthM > FREE_ROAM_MAX_TOTAL_M) {
    return NextResponse.json({ error: "track_too_long" }, { status: 422 });
  }
  const elapsedMin = Math.max(1, Math.floor((Date.now() - access.startedAt) / 60000));
  if (elapsedMin > FREE_ROAM_MAX_DURATION_MIN) {
    return NextResponse.json({ error: "session_too_long" }, { status: 422 });
  }
  // Guard against a degenerate track that matches nothing and yields a ~0 m
  // "walk": refuse instead of paying points for an empty track. (Free-roam is
  // walk-anywhere, so no minimum network coverage — only minimum distance.)
  if (lengthM < FREE_ROAM_MIN_TRACK_M) {
    return NextResponse.json({ error: "track_too_short" }, { status: 422 });
  }

  const streakForMult = streakForPointsMultiplier(user.id);
  const multiplier = streakMultiplier(streakForMult);
  const usageMap = getUsageMap(user.id);
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  // Free-roam has no curated route, so the "preview" derives from what was
  // actually walked (matched segments) — the reduced multiplier still applies.
  const breakdown = computeRoutePointPreview(segmentIds, lengthM, usageMap, goldenMap, canonicalOf);
  const pointsEarned = computeWalkPointsEarned(breakdown, multiplier, false, true);
  const goldenHits = countGoldenHits(segmentIds, goldenMap, canonicalOf);
  const celebrationTier = celebrationTierForWalk(goldenHits, streakForMult, pointsEarned);

  // M1-6/Q10: real duration from the session start, not whatever the client sent.
  const walkDurationMin = Math.max(1, Math.floor((Date.now() - access.startedAt) / 60000));

  const walkId = recordWalkWithPoints(
    user.id,
    nodeChain,
    segmentIds,
    lengthM,
    walkDurationMin,
    nickname ?? null,
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
    // Walk row + anti-replay tombstone commit in ONE transaction (decision K).
    { claimActiveRoute: false, freeRoamStartedAt: access.startedAt },
  );
  // M1-7 refined: -1 means a concurrent request already claimed this session and
  // committed a walk; return the existing credit instead of a 500.
  if (walkId === -1) {
    const existing = completedWalkIdFor(access);
    return NextResponse.json({
      success: true,
      walkId: existing ?? 0,
      freeRoam: true,
      alreadyCredited: true,
    });
  }
  if (walkId == null) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  // Persist the full GPS track so the admin track-geometry page can review it.
  if (trackPoints.length > 0) {
    const pointsJson = JSON.stringify(trackPoints);
    // Single source of truth: walk_track.points_json (mirrors route/complete).
    // walk_log.track_json is a legacy column no longer written — all readers
    // prefer walk_track and fall back cleanly.
    db.prepare(
      `INSERT INTO walk_track (walk_id, points_json) VALUES (?, ?)
       ON CONFLICT(walk_id) DO UPDATE SET points_json = excluded.points_json`,
    ).run(walkId, pointsJson);
    persistHopTimingsFromWalk(walkId, { walkUserId: user.id, walkerIsAdmin: user.role === "admin" });
    // Feed the recorded ground into proposal detection (new junctions).
    detectProposalsFromTrack(trackPoints as { lat: number; lng: number }[], user.id);
  }

  // Stateless sessions (decision K): the token IS the session state; no map to
  // clear. The anti-replay tombstone was already committed with the walk row.
  logActivity(user.id, "walk_complete", "walk", walkId, {
    freeRoam: true,
    nickname,
    lengthM,
    durationMin: walkDurationMin,
    pointsEarned,
  });

  // Decision E: persist earned achievements so weekWarrior/collector can't regress.
  // Best-effort: the walk is already committed — a failure here must not surface
  // as a 500 that makes mobile clients retry and double-book.
  try {
    persistAchievements(user.id, user.locale as Locale);
  } catch (err) {
    console.error("persistAchievements failed (walk already credited):", err);
  }

  const streak = getStreakStats(user.id);
  return NextResponse.json({
    success: true,
    walkId,
    freeRoam: true,
    pointsEarned,
    streakMultiplier: multiplier,
    currentStreak: streak.currentStreak,
    pointBreakdown: breakdown,
    goldenHits,
    celebrationTier,
    pointsMultiplier: FREE_ROAM_POINTS_MULTIPLIER,
  });
}
