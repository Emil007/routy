import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listWalksWithTrack, listPendingSegmentSuggestions } from "@/lib/trackGeometry";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({
    walks: listWalksWithTrack(),
    pending: listPendingSegmentSuggestions(),
  });
}
