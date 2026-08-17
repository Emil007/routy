import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getHomeNode } from "@/lib/nodes";
import { getUsageMap, getDailyUsageMap } from "@/lib/segments";
import { loadGraphContext } from "@/lib/routeContext";
import { findDirectRoutes, findWaypointRoutes, scoreRoutes, pickBest, toleranceRange } from "@/lib/routing";
import { createRouteSession } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";

const bodySchema = z.object({
  mode: z.enum(["km", "min"]),
  targetValue: z.number().positive().max(1000),
  startNodeId: z.number().int().positive().optional(),
  destinationNodeId: z.number().int().positive().optional(),
  waypointNodeId: z.number().int().positive().nullable().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { mode, targetValue, waypointNodeId } = parsed.data;
  // Segments store length/duration as plain meters/minutes; the form collects the
  // target in km, so convert once here and keep everything downstream (including
  // the stored route session) in that same search unit.
  const targetSearchValue = mode === "km" ? targetValue * 1000 : targetValue;

  const home = getHomeNode();
  const startNodeId = parsed.data.startNodeId ?? home?.id;
  if (!startNodeId) {
    return NextResponse.json({ error: "no_home_node" }, { status: 400 });
  }
  const destinationNodeId = parsed.data.destinationNodeId ?? startNodeId;

  const settings = getSettings();
  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  const { minValue, maxValue } = toleranceRange(targetSearchValue, settings.tolerance_percent);

  const candidates =
    waypointNodeId && waypointNodeId !== startNodeId && waypointNodeId !== destinationNodeId
      ? findWaypointRoutes(graph, pairOf, startNodeId, waypointNodeId, destinationNodeId, mode, minValue, maxValue)
      : findDirectRoutes(graph, pairOf, startNodeId, destinationNodeId, mode, minValue, maxValue);

  if (candidates.length === 0) {
    return NextResponse.json({ error: "no_route" }, { status: 404 });
  }

  const usageMap = getUsageMap();
  const dailyMap = getDailyUsageMap();
  const scored = scoreRoutes(
    candidates,
    usageMap,
    dailyMap,
    settings.daily_diversity_weight,
    new Set(),
    targetSearchValue,
    mode,
  );
  const best = pickBest(scored, new Set());
  if (!best) {
    return NextResponse.json({ error: "no_route" }, { status: 404 });
  }

  const token = createRouteSession({
    userId: user.id,
    mode,
    targetValue: targetSearchValue,
    startNodeId,
    destinationNodeId,
    waypointNodeId: waypointNodeId ?? null,
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

  return NextResponse.json({ token, route: display, tolerancePercent: settings.tolerance_percent });
}
