import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSegment, lockSegment, unlockSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";
import { addAvoidSegment, removeAvoidSegment } from "@/lib/avoidList";
import { createLockProposal } from "@/lib/lockProposals";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  scope: z.enum(["personal", "global"]),
  reason: z.string().trim().max(255).optional(),
  days: z.number().int().positive().max(3650).default(7),
  clear: z.boolean().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment || segment.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (parsed.data.clear) {
    if (parsed.data.scope === "personal") {
      removeAvoidSegment(user.id, segment.id);
      return NextResponse.json({ ok: true, action: "cleared_personal" });
    }
    if (!canEdit(user, segment.submittedBy)) {
      return NextResponse.json({ error: "not_owner" }, { status: 403 });
    }
    unlockSegment(segment.id);
    return NextResponse.json({ ok: true, action: "cleared_global" });
  }

  if (parsed.data.scope === "personal") {
    const ok = addAvoidSegment(user.id, segment.id, {
      reason: parsed.data.reason ?? null,
      days: parsed.data.days,
    });
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    logActivity(user.id, "avoid_segment", "segment", segment.id, { reason: parsed.data.reason, days: parsed.data.days });
    return NextResponse.json({ ok: true, action: "personal_avoid" });
  }

  if (canEdit(user, segment.submittedBy)) {
    const until = new Date(Date.now() + parsed.data.days * 86400000).toISOString();
    lockSegment(segment.id, until, parsed.data.reason ?? null);
    logActivity(user.id, "lock", "segment", segment.id, { days: parsed.data.days, reason: parsed.data.reason });
    return NextResponse.json({ ok: true, action: "global_lock", lockedUntil: until });
  }

  const proposal = createLockProposal(segment.id, user.id, parsed.data.days, parsed.data.reason ?? null);
  if (!proposal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logActivity(user.id, "lock_proposal", "segment", segment.id, { proposalId: proposal.id, days: parsed.data.days });
  return NextResponse.json({ ok: true, action: "lock_proposal", proposalId: proposal.id });
}
