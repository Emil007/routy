import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getWalkTrackSuggestions } from "@/lib/trackGeometry";
import { getSegment } from "@/lib/segments";

export async function GET(_request: Request, { params }: { params: Promise<{ walkId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { walkId: walkIdRaw } = await params;
  const walkId = Number(walkIdRaw);
  if (!Number.isFinite(walkId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const suggestions = getWalkTrackSuggestions(walkId);
  const enriched = suggestions.map((s) => {
    const segment = getSegment(s.segmentId);
    return {
      ...s,
      officialGeometry: segment?.geometry ?? [],
    };
  });

  return NextResponse.json({ walkId, suggestions: enriched });
}
