import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getHomeNode } from "@/lib/nodes";
import { getUsageMap, getDailyUsageMap, listSegments } from "@/lib/segments";
import { getRouteScoringContext } from "@/lib/routeScoring";
import { loadGraphContext } from "@/lib/routeContext";
import {
  findDirectRoutes,
  findWaypointRoutes,
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

const bodySchema = z.object({
  startNodeId: z.number().int().positive().optional(),
  destinationNodeId: z.number().int().positive().optional(),
  waypointNodeId: z.number().int().positive().nullable().optional(),
  explorerMode: z.boolean().default(false),
  surpriseMode: z.boolean().default(false),
  /** Biases the search toward the lower/upper half of the configured suggest-length range. */
  preset: z.enum(["short", "long", "surprise"]).optional(),
  /** Require a route that uses at least one of today's golden segments. */
  forceGolden: z.boolean().default(false),
});

function searchCandidates(
  graph: Parameters<typeof findDirectRoutes>[0],
  pairOf: Parameters<typeof findDirectRoutes>[1],
  startNodeId: number,
  destinationNodeId: number,
  waypointNodeId: number | null | undefined,
  mode: "km",
  minValue: number,
  maxValue: number,
): RouteResult[] {
  if (waypointNodeId && waypointNodeId !== startNodeId && waypointNodeId !== destinationNodeId) {
    return findWaypointRoutes(graph, pairOf, startNodeId, waypointNodeId, destinationNodeId, mode, minValue, maxValue);
  }
  return findDirectRoutes(graph, pairOf, startNodeId, destinationNodeId, mode, minValue, maxValue);
}

/** Extra candidates that pass through an endpoint of today's golden segments. */
function goldenWaypointCandidates(
  graph: Parameters<typeof findDirectRoutes>[0],
  pairOf: Parameters<typeof findDirectRoutes>[1],
  startNodeId: number,
  destinationNodeId: number,
  mode: "km",
  minValue: number,
  maxValue: number,
  segmentsById: Map<number, { startNodeId: number; endNodeId: number }>,
  existing: RouteResult[],
): RouteResult[] {
  const seen = new Set(existing.map((r) => segmentSetKey(r.segmentIds)));
  const extra: RouteResult[] = [];
  for (const goldenId of getTodayGoldenSegmentIds()) {
    const seg = segmentsById.get(goldenId);
    if (!seg) continue;
    for (const wp of [seg.startNodeId, seg.endNodeId]) {
      if (wp === startNodeId || wp === destinationNodeId) continue;
      for (const route of findWaypointRoutes(
        graph,
        pairOf,
        startNodeId,
        wp,
        destinationNodeId,
        mode,
        minValue,
        maxValue,
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

  const rate = checkGenerateRateLimit(user.id);
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { waypointNodeId, explorerMode, preset, forceGolden } = parsed.data;
  const surpriseMode = parsed.data.surpriseMode || preset === "surprise";

  const home = getHomeNode();
  const startNodeId = parsed.data.startNodeId ?? home?.id;
  if (!startNodeId) {
    return NextResponse.json({ error: "no_home_node" }, { status: 400 });
  }
  const destinationNodeId = parsed.data.destinationNodeId ?? startNodeId;

  const settings = getSettings();
  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  // No exact target: search the whole preferred-length band and let the scorer
  // (least backtracking, then least-used segments) pick the nicest route in it,
  // rather than fixating on hitting one specific number of meters. A short/long
  // preset narrows the search to the lower/upper half of that same band instead
  // of introducing a separate, unconfigurable range.
  const fullMinValue = settings.suggest_min_km * 1000;
  const fullMaxValue = settings.suggest_max_km * 1000;
  const midValue = (fullMinValue + fullMaxValue) / 2;
  const minValue = preset === "long" ? midValue : fullMinValue;
  const maxValue = preset === "short" ? midValue : fullMaxValue;
  const mode = "km" as const;

  let candidates = searchCandidates(
    graph,
    pairOf,
    startNodeId,
    destinationNodeId,
    waypointNodeId,
    mode,
    minValue,
    maxValue,
  );

  const usageMap = getUsageMap();
  const dailyMap = getDailyUsageMap();
  const { avoidSegmentIds, conditionCounts, staleSegmentIds } = getRouteScoringContext(user.id, surpriseMode);
  const geometryOf = new Map([...segmentsById].map(([id, s]) => [id, s.geometry]));
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));

  function score(cands: RouteResult[]) {
    return scoreRoutes(
      cands,
      pairOf,
      usageMap,
      dailyMap,
      settings.daily_diversity_weight,
      new Set(),
      (minValue + maxValue) / 2,
      mode,
      geometryOf,
      avoidSegmentIds,
      conditionCounts,
      staleSegmentIds,
      goldenMap,
    );
  }

  let scored = candidates.length > 0 ? score(candidates) : [];
  let scoredPool = forceGolden ? withGoldenHits(scored, goldenMap, canonicalOf) : scored;

  // forceGolden: if nothing in the normal pool actually uses a golden segment,
  // route via golden endpoints (unless the user already fixed a waypoint).
  if (forceGolden && scoredPool.length === 0 && !waypointNodeId) {
    const extra = goldenWaypointCandidates(
      graph,
      pairOf,
      startNodeId,
      destinationNodeId,
      mode,
      minValue,
      maxValue,
      segmentsById,
      candidates,
    );
    if (extra.length > 0) {
      candidates = [...candidates, ...extra];
      scored = score(candidates);
      scoredPool = withGoldenHits(scored, goldenMap, canonicalOf);
    }
  }

  if (forceGolden && scoredPool.length === 0) {
    return NextResponse.json({ error: "no_golden_route" }, { status: 404 });
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
    targetValue: (minValue + maxValue) / 2,
    startNodeId,
    destinationNodeId,
    waypointNodeId: waypointNodeId ?? null,
    explorerMode,
    surpriseMode,
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
