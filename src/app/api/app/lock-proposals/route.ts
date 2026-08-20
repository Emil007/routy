import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listPendingLockProposalsForReviewer } from "@/lib/lockProposals";
import { getSegment } from "@/lib/segments";
import { getUser } from "@/lib/users";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const proposals = listPendingLockProposalsForReviewer(user.id, user.role === "admin").map((p) => {
    const seg = getSegment(p.segmentId);
    const requester = getUser(p.requestedBy);
    return {
      id: p.id,
      segmentId: p.segmentId,
      segmentName: seg?.name ?? null,
      requestedBy: p.requestedBy,
      requesterName: requester?.displayName ?? "?",
      reason: p.reason,
      days: p.days,
      createdAt: p.createdAt,
    };
  });

  return NextResponse.json({ proposals });
}
