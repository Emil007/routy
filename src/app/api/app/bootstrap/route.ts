import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { listNodes } from "@/lib/nodes";
import { listSegments } from "@/lib/segments";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { getBootstrapVersion } from "@/lib/bootstrapVersion";
import { getNetworkVersion } from "@/lib/networkVersion";
import { listAvoidSegmentIds } from "@/lib/avoidList";
import { listActiveConditions } from "@/lib/segmentConditions";
import { conditionalJson } from "@/lib/conditionalJson";

function buildRouteState(userId: number) {
  const { nodesById, segmentsById } = loadGraphContext();
  const active = getActiveRoute(userId);
  const activeRoute = active
    ? buildRouteDisplay(active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, nodesById, segmentsById)
    : null;

  const favorites = listFavorites(userId).map((f) => ({
    id: f.id,
    name: f.name,
    shareToken: f.shareToken,
    display: buildRouteDisplay(f.nodeChain, f.segmentIds, f.lengthM, f.durationMin, nodesById, segmentsById),
  }));

  return { activeRoute, nickname: active?.nickname ?? null, favorites };
}

/** Single launch payload: user profile, network data, and route state. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = await resolveLocale(user.locale);
  const routeState = buildRouteState(user.id);
  const etag = getBootstrapVersion(user.id);

  return conditionalJson(request, etag, {
    user: { ...user, locale },
    networkVersion: getNetworkVersion(),
    nodes: listNodes(),
    segments: listSegments(),
    avoidSegmentIds: listAvoidSegmentIds(user.id),
    segmentConditions: listActiveConditions().map((c) => ({
      id: c.id,
      segmentId: c.segmentId,
      reason: c.reason,
      reportedBy: c.reportedBy,
      expiresAt: c.expiresAt,
    })),
    routeState,
  });
}
