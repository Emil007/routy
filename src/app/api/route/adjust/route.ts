import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getUsageMap, getDailyUsageMap, listSegments } from "@/lib/segments";
import { getRouteScoringContext } from "@/lib/routeScoring";
import { loadGraphContext } from "@/lib/routeContext";
import { searchRoutesWithConstraints, scoreRoutes, pickBest, type ScoredRoute } from "@/lib/routing";
import { updateRouteSession, assertRouteSessionOwner } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { computeRoutePointPreview, canonicalSegmentId, countGoldenHits, goldenHitCanonicalIds } from "@/lib/points";
import { getHomeAccessSegmentIds } from "@/lib/homeAccess";

const bodySchema = z.object({ token: z.string().min(1), direction: z.enum(["longer", "shorter"]) });

function withGoldenHits(
  scored: ScoredRoute[],
  goldenMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): ScoredRoute[] {
  return scored.filter((s) => countGoldenHits(s.route.segmentIds, goldenMap, canonicalOf) > 0);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = user.id;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { token, direction } = parsed.data;

  const access = assertRouteSessionOwner(token, userId);
  if (access === "missing") return NextResponse.json({ error: "session_expired" }, { status: 410 });
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = access;

  const settings = getSettings();
  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  const { avoidSegmentIds, conditionCounts, staleSegmentIds } = getRouteScoringContext(userId, session.surpriseMode);
  const currentValue = session.mode === "km" ? session.current.lengthM : session.current.durationMin;
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const homeAccess = getHomeAccessSegmentIds(userId);
  const mustVisit = session.mustVisitNodeIds?.length
    ? session.mustVisitNodeIds
    : session.waypointNodeId != null
      ? [session.waypointNodeId]
      : [];
  const excluded = new Set(session.excludedSegmentIds ?? []);

  function band(stepPercent: number): { minValue: number; maxValue: number } {
    const step = stepPercent / 100;
    if (direction === "longer") {
      return { minValue: currentValue * 1.05, maxValue: currentValue * (1 + step) };
    }
    const minValue = Math.max(currentValue * 0.2, currentValue * (1 - step));
    return { minValue, maxValue: currentValue * 0.95 };
  }

  function search(minValue: number, maxValue: number) {
    const { routes: candidates } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: session.startNodeId,
      destination: session.destinationNodeId,
      mustVisitNodeIds: mustVisit,
      requiredSegmentIds: session.requiredSegmentIds ?? [],
      excludedSegmentIds: excluded,
      mode: session.mode,
      minValue,
      maxValue,
    });

    const usageMap = getUsageMap(userId);
    const dailyMap = getDailyUsageMap(userId);
    const geometryOf = new Map([...segmentsById].map(([id, s]) => [id, s.geometry]));
    let scored = scoreRoutes(
      candidates,
      pairOf,
      usageMap,
      dailyMap,
      settings.daily_diversity_weight,
      session.seenUnion,
      (minValue + maxValue) / 2,
      session.mode,
      geometryOf,
      avoidSegmentIds,
      conditionCounts,
      staleSegmentIds,
      goldenMap,
      homeAccess,
    );
    if (session.forceGolden) {
      scored = withGoldenHits(scored, goldenMap, canonicalOf);
    }
    return pickBest(scored, session.seenKeys, session.explorerMode, session.surpriseMode);
  }

  const initial = band(settings.adjust_step_percent);
  let best = search(initial.minValue, initial.maxValue);
  if (!best) {
    const wider = band(settings.adjust_step_percent * 2);
    best = search(wider.minValue, wider.maxValue);
  }
  if (!best) {
    return NextResponse.json({ error: "no_alternative" }, { status: 404 });
  }

  session.seenKeys.add(best.key);
  for (const id of best.route.segmentIds) session.seenUnion.add(id);

  updateRouteSession(token, {
    current: {
      nodeChain: best.route.nodeChain,
      segmentIds: best.route.segmentIds,
      lengthM: best.route.lengthM,
      durationMin: best.route.durationMin,
    },
    seenKeys: session.seenKeys,
    seenUnion: session.seenUnion,
  });

  const display = buildRouteDisplay(
    best.route.nodeChain,
    best.route.segmentIds,
    best.route.lengthM,
    best.route.durationMin,
    nodesById,
    segmentsById,
  );

  const usageMap = getUsageMap(userId);
  const pointPreview = computeRoutePointPreview(
    best.route.segmentIds,
    best.route.lengthM,
    usageMap,
    goldenMap,
    canonicalOf,
    homeAccess,
  );
  const goldenHitIds = goldenHitCanonicalIds(best.route.segmentIds, goldenMap, canonicalOf);

  return NextResponse.json({
    token,
    route: display,
    pointPreview,
    goldenHits: goldenHitIds.length,
    goldenHitIds,
  });
}
