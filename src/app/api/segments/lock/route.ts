import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSegment, lockSegment, unlockSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  days: z.number().int().positive().max(3650).nullable(),
  reason: z.string().trim().max(255).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment || segment.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  if (parsed.data.days === null) {
    unlockSegment(segment.id);
    logActivity(user.id, "unlock", "segment", segment.id, { name: segment.name });
    return NextResponse.json({ ok: true, lockedUntil: null });
  }

  const until = new Date(Date.now() + parsed.data.days * 86400000).toISOString();
  lockSegment(segment.id, until, parsed.data.reason || null);
  logActivity(user.id, "lock", "segment", segment.id, { name: segment.name, days: parsed.data.days, reason: parsed.data.reason });
  return NextResponse.json({ ok: true, lockedUntil: until });
}
