import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { listNodes } from "@/lib/nodes";
import { listSegments } from "@/lib/segments";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { getNetworkVersion } from "@/lib/networkVersion";

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
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = await resolveLocale(user.locale);
  const routeState = buildRouteState(user.id);

  return NextResponse.json({
    user: { ...user, locale },
    networkVersion: getNetworkVersion(),
    nodes: listNodes(),
    segments: listSegments(),
    routeState,
  });
}
