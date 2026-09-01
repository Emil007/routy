import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { loadGraphContext } from "@/lib/routeContext";
import { assertRouteSessionOwner, updateRouteSession } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { reverseRouteResult } from "@/lib/routeReverse";
import { computeRoutePointPreview, canonicalSegmentId, goldenHitCanonicalIds } from "@/lib/points";
import { getGoldenMultiplierMap } from "@/lib/goldenSegments";
import { getUsageMap, listSegments } from "@/lib/segments";
import { getHomeAccessSegmentIds } from "@/lib/homeAccess";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { token } = parsed.data;

  const access = assertRouteSessionOwner(token, user.id);
  if (access === "missing") return NextResponse.json({ error: "session_expired" }, { status: 410 });
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = access;

  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  void graph;
  const reversed = reverseRouteResult(session.current, pairOf, segmentsById);
  if (!reversed) return NextResponse.json({ error: "cannot_reverse" }, { status: 400 });

  updateRouteSession(token, { current: reversed });

  const display = buildRouteDisplay(
    reversed.nodeChain,
    reversed.segmentIds,
    reversed.lengthM,
    reversed.durationMin,
    nodesById,
    segmentsById,
  );

  const goldenMap = getGoldenMultiplierMap();
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  const usageMap = getUsageMap(user.id);
  const homeAccess = getHomeAccessSegmentIds(user.id);
  const pointPreview = computeRoutePointPreview(
    reversed.segmentIds,
    reversed.lengthM,
    usageMap,
    goldenMap,
    canonicalOf,
    homeAccess,
  );
  const goldenHitIds = goldenHitCanonicalIds(reversed.segmentIds, goldenMap, canonicalOf);

  return NextResponse.json({
    token,
    route: display,
    pointPreview,
    goldenHits: goldenHitIds.length,
    goldenHitIds,
  });
}
