import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listPendingProposals } from "@/lib/discovery";
import { getSegment } from "@/lib/segments";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const proposals = listPendingProposals()
    .map((p) => {
      const segment = getSegment(p.segmentId);
      return segment && !segment.deletedAt
        ? {
            id: p.id,
            segmentId: p.segmentId,
            segmentName: segment.name,
            lat: p.lat,
            lng: p.lng,
            createdBy: p.createdBy,
            createdAt: p.createdAt,
          }
        : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return NextResponse.json({ proposals });
}
