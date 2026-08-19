import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getFavoriteByShareToken } from "@/lib/favorites";
import { getSegment } from "@/lib/segments";
import { setActiveRoute } from "@/lib/activeRoute";

/** Accept a shared favorite by token and set it as the signed-in user's active route. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { token } = await params;
  const favorite = getFavoriteByShareToken(token);
  if (!favorite) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
