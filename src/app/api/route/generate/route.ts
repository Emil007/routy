import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getUserHomeNode } from "@/lib/nodes";
import { getUsageMap, getDailyUsageMap, listSegments } from "@/lib/segments";
import { getRouteScoringContext } from "@/lib/routeScoring";
import { loadGraphContext } from "@/lib/routeContext";
import {
  searchRoutesWithConstraints,
  findMultiWaypointRoutes,
  scoreRoutes,
  pickBest,
  segmentSetKey,
  type RouteResult,
  type ScoredRoute,
} from "@/lib/routing";
import { createRouteSession } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { checkGenerateRateLimit } from "@/lib/generateRateLimit";
import { getGoldenMultiplierMap, getTodayGoldenSegmentIds } from "@/lib/goldenSegments";
import { computeRoutePointPreview, canonicalSegmentId, countGoldenHits, goldenHitCanonicalIds } from "@/lib/points";
import { getHomeAccessSegmentIds } from "@/lib/homeAccess";
import { lengthBandForUser } from "@/lib/lengthTaste";

const bodySchema = z.object({
  startNodeId: z.number().int().positive().optional(),
  destinationNodeId: z.number().int().positive().optional(),
  /** @deprecated use mustVisitNodeIds */
  waypointNodeId: z.number().int().positive().nullable().optional(),
  mustVisitNodeIds: z.array(z.number().int().positive()).max(8).optional(),
  requiredSegmentIds: z.array(z.number().int().positive()).max(20).optional(),
  excludedSegmentIds: z.array(z.number().int().positive()).max(40).optional(),
  explorerMode: z.boolean().default(false),
  surpriseMode: z.boolean().default(false),
  preset: z.enum(["short", "normal", "long", "surprise"]).optional(),
  forceGolden: z.boolean().default(false),
});

function withGoldenHits(
  scored: ScoredRoute[],
  goldenMap: Map<number, number>,
  canonicalOf: Map<number, number>,
): ScoredRoute[] {
  return scored.filter((s) => countGoldenHits(s.route.segmentIds, goldenMap, canonicalOf) > 0);
}

function goldenWaypointCandidates(
  graph: Parameters<typeof findMultiWaypointRoutes>[0],
  pairOf: Parameters<typeof findMultiWaypointRoutes>[1],
  startNodeId: number,
  destinationNodeId: number,
  mustVisit: number[],
  mode: "km",
  minValue: number,
  maxValue: number,
  excluded: Set<number>,
  segmentsById: Map<number, { startNodeId: number; endNodeId: number }>,
  existing: RouteResult[],
): RouteResult[] {
  const seen = new Set(existing.map((r) => segmentSetKey(r.segmentIds)));
  const extra: RouteResult[] = [];
  for (const goldenId of getTodayGoldenSegmentIds()) {
    const seg = segmentsById.get(goldenId);
    if (!seg) continue;
    for (const wp of [seg.startNodeId, seg.endNodeId]) {
      if (wp === startNodeId || wp === destinationNodeId || mustVisit.includes(wp)) continue;
      for (const route of findMultiWaypointRoutes(
        graph,
        pairOf,
        startNodeId,
        [...mustVisit, wp],
        destinationNodeId,
        mode,
        minValue,
        maxValue,
        80,
        excluded,
      )) {
        const key = segmentSetKey(route.segmentIds);
        if (seen.has(key)) continue;
        seen.add(key);
        extra.push(route);
      }
    }
  }
  return extra;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rate = checkGenerateRateLimit(user.id);
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { explorerMode, preset, forceGolden, requiredSegmentIds = [], excludedSegmentIds = [] } = parsed.data;
  const surpriseMode = parsed.data.surpriseMode || preset === "surprise";
  const mustVisitNodeIds =
    parsed.data.mustVisitNodeIds ??
    (parsed.data.waypointNodeId != null ? [parsed.data.waypointNodeId] : []);

  const home = getUserHomeNode(user.id);
  const startNodeId = parsed.data.startNodeId ?? home?.id;
  if (!startNodeId) {
    return NextResponse.json({ error: "no_home_node" }, { status: 400 });
  }
  const destinationNodeId = parsed.data.destinationNodeId ?? startNodeId;

  const settings = getSettings();
  const band = lengthBandForUser(user.id, surpriseMode ? "surprise" : preset);
  const minValue = band.minM;
  const maxValue = band.maxM;
  const mode = "km" as const;
  const excluded = new Set(excludedSegmentIds);

  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  const usageMap = getUsageMap();
  const dailyMap = getDailyUsageMap();
  const { avoidSegmentIds, conditionCounts, staleSegmentIds } = getRouteScoringContext(user.id, surpriseMode);
  const geometryOf = new Map([...segmentsById].map(([id, s]) => [id, s.geometry]));
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const homeAccess = getHomeAccessSegmentIds(user.id);

  let { routes: candidates, lengthRelaxed } = searchRoutesWithConstraints({
    graph,
    pairOf,
    start: startNodeId,
    destination: destinationNodeId,
    mustVisitNodeIds,
    requiredSegmentIds,
    excludedSegmentIds: excluded,
    mode,
    minValue,
    maxValue,
  });

  function score(cands: RouteResult[]) {
    return scoreRoutes(
      cands,
      pairOf,
      usageMap,
      dailyMap,
      settings.daily_diversity_weight,
      new Set(),
      band.targetM,
      mode,
      geometryOf,
      avoidSegmentIds,
      conditionCounts,
      staleSegmentIds,
      goldenMap,
      homeAccess,
    );
  }

  let scored = candidates.length > 0 ? score(candidates) : [];
  let scoredPool = forceGolden ? withGoldenHits(scored, goldenMap, canonicalOf) : scored;

  if (forceGolden && scoredPool.length === 0 && mustVisitNodeIds.length === 0) {
    const extra = goldenWaypointCandidates(
      graph,
      pairOf,
      startNodeId,
      destinationNodeId,
      mustVisitNodeIds,
      mode,
      minValue,
      maxValue,
      excluded,
      segmentsById,
      candidates,
    );
    if (extra.length > 0) {
      candidates = [...candidates, ...extra];
      scored = score(candidates);
      scoredPool = withGoldenHits(scored, goldenMap, canonicalOf);
    }
  }

  // forceGolden with length-relaxed open search if still empty
  if (forceGolden && scoredPool.length === 0) {
    const open = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: startNodeId,
      destination: destinationNodeId,
      mustVisitNodeIds,
      requiredSegmentIds,
      excludedSegmentIds: excluded,
      mode,
      minValue: 0,
      maxValue: Number.POSITIVE_INFINITY,
    });
    if (open.routes.length > 0) {
      candidates = open.routes;
      lengthRelaxed = true;
      scored = score(candidates);
      scoredPool = withGoldenHits(scored, goldenMap, canonicalOf);
    }
  }

  if (forceGolden && scoredPool.length === 0) {
    return NextResponse.json({ error: "no_golden_route" }, { status: 404 });
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: "constraints_impossible" }, { status: 404 });
  }
  if (scoredPool.length === 0) {
    return NextResponse.json({ error: "no_route" }, { status: 404 });
  }

  const best = pickBest(scoredPool, new Set(), explorerMode, surpriseMode);
  if (!best) {
    return NextResponse.json({ error: forceGolden ? "no_golden_route" : "no_route" }, { status: 404 });
  }

  const token = createRouteSession({
    userId: user.id,
    mode,
    targetValue: band.targetM,
    startNodeId,
    destinationNodeId,
    waypointNodeId: mustVisitNodeIds[0] ?? null,
    mustVisitNodeIds,
    requiredSegmentIds,
    excludedSegmentIds,
    explorerMode,
    surpriseMode,
    forceGolden,
    preset: surpriseMode ? "surprise" : preset ?? "normal",
    current: {
      nodeChain: best.route.nodeChain,
      segmentIds: best.route.segmentIds,
      lengthM: best.route.lengthM,
      durationMin: best.route.durationMin,
    },
    seenKeys: new Set([best.key]),
    seenUnion: new Set(best.route.segmentIds),
    widenSteps: 0,
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
    homeAccess,
  );
  const goldenHitIds = goldenHitCanonicalIds(best.route.segmentIds, goldenMap, canonicalOf);

  return NextResponse.json({
    token,
    route: display,
    pointPreview,
    goldenHits: goldenHitIds.length,
    goldenHitIds,
    lengthRelaxed,
    lengthKm: best.route.lengthM / 1000,
    usingNetworkFallback: band.usingNetworkFallback,
  });
}
