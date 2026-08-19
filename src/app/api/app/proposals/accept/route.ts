import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getProposal, acceptProposal as markProposalAccepted } from "@/lib/discovery";
import { splitSegment, getSegment } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { segmentUsedByActiveRoute } from "@/lib/activeRoute";
import { canEdit } from "@/lib/ownership";
import { resolveNamePartsInput } from "@/lib/nameParts";
import { logActivity } from "@/lib/activityLog";
import { db } from "@/lib/db";

const bodySchema = z.object({
  proposalId: z.number().int().positive(),
  part1: z.string().trim().max(255).optional(),
  part2: z.string().trim().max(255).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const proposal = getProposal(parsed.data.proposalId);
  if (!proposal || proposal.status !== "pending") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const segment = getSegment(proposal.segmentId);
  if (!segment || segment.deletedAt) return NextResponse.json({ error: "segment_not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const relatedIds = [segment.id, ...(segment.reverseOf !== null ? [segment.reverseOf] : [])];
  if (segmentUsedByActiveRoute(relatedIds)) {
    return NextResponse.json({ error: "segment_active" }, { status: 409 });
  }

  const { name, nameParts } = resolveNamePartsInput(parsed.data.part1 ?? "", parsed.data.part2 ?? "", "/", user.id);
  const settings = getSettings();
  const walkSpeed = effectiveWalkSpeedKmh(user.walkSpeedKmh, settings);

  let result: { newNodeId: number } | { error: string };
  try {
    result = db.transaction(() => {
      const splitResult = splitSegment(
        proposal.segmentId,
        { lat: proposal.lat, lng: proposal.lng },
        { newName: name, nameParts },
        user.id,
        walkSpeed,
      );
      if ("error" in splitResult) throw new Error(splitResult.error);
      if (!markProposalAccepted(proposal.id)) throw new Error("proposal_gone");
      return splitResult;
    })();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "proposal_gone") return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  logActivity(user.id, "accept_proposal", "segment", segment.id, { proposalId: proposal.id, newNodeId: result.newNodeId });
  return NextResponse.json({ ok: true, newNodeId: result.newNodeId });
}
