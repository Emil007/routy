import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { approveLockProposal, getLockProposal } from "@/lib/lockProposals";
import { getSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ proposalId: z.number().int().positive() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const proposal = getLockProposal(parsed.data.proposalId);
  if (!proposal || proposal.status !== "pending") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const segment = getSegment(proposal.segmentId);
  if (!segment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  if (!approveLockProposal(proposal.id, user.id, user.role === "admin")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  logActivity(user.id, "approve_lock_proposal", "segment", segment.id, { proposalId: proposal.id });
  return NextResponse.json({ ok: true });
}
