import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getFavorite } from "@/lib/favorites";
import { getSegment } from "@/lib/segments";
import { setActiveRoute } from "@/lib/activeRoute";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const favoriteId = Number(id);
  if (!Number.isInteger(favoriteId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const favorite = getFavorite(favoriteId, user.id);
  if (!favorite) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The network may have changed (segment deleted/split) since the favorite was
  // saved — better to tell the user their favorite is stale than to silently
  // set an active route pointing at segments that no longer exist. getSegment
  // still returns a soft-deleted row, so check deletedAt explicitly too.
  const stale = favorite.segmentIds.some((segId) => {
    const segment = getSegment(segId);
    return !segment || segment.deletedAt !== null;
  });
  if (stale) return NextResponse.json({ error: "favorite_stale" }, { status: 409 });

  setActiveRoute(user.id, {
    nodeChain: favorite.nodeChain,
    segmentIds: favorite.segmentIds,
    lengthM: favorite.lengthM,
    durationMin: favorite.durationMin,
  });

  return NextResponse.json({ ok: true });
}
