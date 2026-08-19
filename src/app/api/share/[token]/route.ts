import { NextResponse } from "next/server";
import { getFavoriteByShareToken } from "@/lib/favorites";
import { getSegment } from "@/lib/segments";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";

/** Public JSON resolver for shared favorite links — used by the native app deep-link flow. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const favorite = getFavoriteByShareToken(token);
  if (!favorite) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const stale = favorite.segmentIds.some((segId) => {
    const segment = getSegment(segId);
    return !segment || segment.deletedAt !== null;
  });

  const { nodesById, segmentsById } = loadGraphContext();
  const display = stale
    ? null
    : buildRouteDisplay(favorite.nodeChain, favorite.segmentIds, favorite.lengthM, favorite.durationMin, nodesById, segmentsById);

  return NextResponse.json({
    name: favorite.name,
    stale,
    display,
    nodeChain: favorite.nodeChain,
    segmentIds: favorite.segmentIds,
    lengthM: favorite.lengthM,
    durationMin: favorite.durationMin,
  });
}
