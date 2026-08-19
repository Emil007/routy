import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { CONDITION_REASONS, reportCondition } from "@/lib/segmentConditions";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  reason: z.enum(CONDITION_REASONS),
  days: z.number().int().positive().max(90).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const created = reportCondition(parsed.data.segmentId, parsed.data.reason, user.id, parsed.data.days);
  if (!created) return NextResponse.json({ error: "segment_not_found" }, { status: 404 });

  logActivity(user.id, "report_condition", "segment", parsed.data.segmentId, {
    reason: parsed.data.reason,
    expiresAt: created.expiresAt,
  });

  return NextResponse.json({ condition: created });
}
