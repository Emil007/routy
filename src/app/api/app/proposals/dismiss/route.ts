import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { dismissProposal, getProposal } from "@/lib/discovery";
import { getSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";

const bodySchema = z.object({ proposalId: z.number().int().positive() });

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

  if (!dismissProposal(parsed.data.proposalId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
