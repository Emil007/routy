import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { listNodes } from "@/lib/nodes";
import { loadGraphContext } from "@/lib/routeContext";
import { buildGuideRoute, guideNodeChain } from "@/lib/guideRoute";
import { createRouteSession } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { computeRoutePointPreview, canonicalSegmentId, GUIDE_POINTS_MULTIPLIER } from "@/lib/points";
import { getUsageMap, listSegments } from "@/lib/segments";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";

const bodySchema = z.object({
  orderedNodeIds: z.array(z.number().int().positive()).min(1).max(12),
  loopBack: z.boolean().default(true),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const { orderedNodeIds, loopBack } = parsed.data;
  const nodes = listNodes();
  const nodeSet = new Set(nodes.map((n) => n.id));
  if (orderedNodeIds.some((id) => !nodeSet.has(id))) {
    return NextResponse.json({ error: "unknown_node" }, { status: 400 });
  }

  const { graph, nodesById, segmentsById } = loadGraphContext();
  const built = buildGuideRoute(graph, orderedNodeIds, loopBack);
  const visitChain = guideNodeChain(orderedNodeIds, loopBack);
  const routeBody = built ?? {
    nodeChain: visitChain,
    segmentIds: [] as number[],
    lengthM: 0,
    durationMin: 0,
  };

  const token = createRouteSession({
    userId: user.id,
    mode: "km",
    targetValue: routeBody.lengthM,
    startNodeId: orderedNodeIds[0]!,
    destinationNodeId: loopBack ? orderedNodeIds[0]! : orderedNodeIds[orderedNodeIds.length - 1]!,
    waypointNodeId: null,
    mustVisitNodeIds: orderedNodeIds,
    explorerMode: false,
    surpriseMode: false,
    current: {
      nodeChain: routeBody.nodeChain,
      segmentIds: routeBody.segmentIds,
      lengthM: routeBody.lengthM,
      durationMin: routeBody.durationMin,
    },
    seenKeys: new Set(),
    seenUnion: new Set(routeBody.segmentIds),
    widenSteps: 0,
    walkMode: "guide",
    guideNodeIds: orderedNodeIds,
  });

  const display = buildRouteDisplay(
    routeBody.nodeChain,
    routeBody.segmentIds,
    routeBody.lengthM,
    routeBody.durationMin,
    nodesById,
    segmentsById,
  );

  const usageMap = getUsageMap(user.id);
  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const pointPreview = computeRoutePointPreview(
    routeBody.segmentIds,
    routeBody.lengthM,
    usageMap,
    goldenMap,
    canonicalOf,
  );

  return NextResponse.json({
    token,
    route: display,
    pointPreview,
    guideMode: true,
    pointsMultiplier: GUIDE_POINTS_MULTIPLIER,
    orderedNodeIds,
  });
}
