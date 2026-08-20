import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getUsageMap, getDailyUsageMap, listSegments } from "@/lib/segments";
import { getRouteScoringContext } from "@/lib/routeScoring";
import { loadGraphContext } from "@/lib/routeContext";
import { findDirectRoutes, findWaypointRoutes, scoreRoutes, pickBest, toleranceRange } from "@/lib/routing";
import { updateRouteSession, assertRouteSessionOwner } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { computeRoutePointPreview, canonicalSegmentId, goldenHitCanonicalIds } from "@/lib/points";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const access = assertRouteSessionOwner(parsed.data.token, user.id);
  if (access === "missing") return NextResponse.json({ error: "session_expired" }, { status: 410 });
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = access;

  const settings = getSettings();
  const nextWidenSteps = session.widenSteps + 1;
  let effectiveTolerance = settings.tolerance_percent + nextWidenSteps * settings.widen_step_percent;
  const cap = settings.tolerance_percent + settings.widen_max_percent;
  if (effectiveTolerance > cap) effectiveTolerance = cap;

  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  const { avoidSegmentIds, conditionCounts, staleSegmentIds } = getRouteScoringContext(user.id, session.surpriseMode);
  const { minValue, maxValue } = toleranceRange(session.targetValue, effectiveTolerance);
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));

  const candidates =
    session.waypointNodeId &&
    session.waypointNodeId !== session.startNodeId &&
    session.waypointNodeId !== session.destinationNodeId
      ? findWaypointRoutes(
          graph,
          pairOf,
          session.startNodeId,
          session.waypointNodeId,
          session.destinationNodeId,
          session.mode,
          minValue,
          maxValue,
        )
      : findDirectRoutes(
          graph,
          pairOf,
          session.startNodeId,
          session.destinationNodeId,
          session.mode,
          minValue,
          maxValue,
        );

  const usageMap = getUsageMap();
  const dailyMap = getDailyUsageMap();
  const geometryOf = new Map([...segmentsById].map(([id, s]) => [id, s.geometry]));
  const scored = scoreRoutes(
    candidates,
    pairOf,
    usageMap,
    dailyMap,
    settings.daily_diversity_weight,
    session.seenUnion,
    session.targetValue,
    session.mode,
    geometryOf,
    avoidSegmentIds,
    conditionCounts,
    staleSegmentIds,
    goldenMap,
  );
  const best = pickBest(scored, session.seenKeys, session.explorerMode, session.surpriseMode);

  if (!best) {
    return NextResponse.json({ error: "no_alternative", tolerancePercent: effectiveTolerance }, { status: 404 });
  }

  session.seenKeys.add(best.key);
  for (const id of best.route.segmentIds) session.seenUnion.add(id);

  updateRouteSession(parsed.data.token, {
    current: {
      nodeChain: best.route.nodeChain,
      segmentIds: best.route.segmentIds,
      lengthM: best.route.lengthM,
      durationMin: best.route.durationMin,
    },
    seenKeys: session.seenKeys,
    seenUnion: session.seenUnion,
    widenSteps: nextWidenSteps,
  });

  const display = buildRouteDisplay(
    best.route.nodeChain,
    best.route.segmentIds,
    best.route.lengthM,
    best.route.durationMin,
    nodesById,
    segmentsById,
  );

  const pointPreview = computeRoutePointPreview(
    best.route.segmentIds,
    best.route.lengthM,
    usageMap,
    goldenMap,
    canonicalOf,
  );
  const goldenHitIds = goldenHitCanonicalIds(best.route.segmentIds, goldenMap, canonicalOf);

  return NextResponse.json({
    token: parsed.data.token,
    route: display,
    tolerancePercent: effectiveTolerance,
    pointPreview,
    goldenHits: goldenHitIds.length,
    goldenHitIds,
  });
}
