import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";

/**
 * The web client gets this data server-side in the /route page's RSC (see
 * src/app/(app)/route/page.tsx) — this mirrors that exact query set as a REST GET for the
 * native client, which has no equivalent to a server component render.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { nodesById, segmentsById } = loadGraphContext();

  const active = getActiveRoute(user.id);
  const activeRoute = active
    ? buildRouteDisplay(active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, nodesById, segmentsById)
    : null;

  const favorites = listFavorites(user.id).map((f) => ({
    id: f.id,
    name: f.name,
    shareToken: f.shareToken,
    display: buildRouteDisplay(f.nodeChain, f.segmentIds, f.lengthM, f.durationMin, nodesById, segmentsById),
  }));

  return NextResponse.json({ activeRoute, nickname: active?.nickname ?? null, favorites });
}
