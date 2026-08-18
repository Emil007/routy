import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSegment, purgeSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ segmentId: z.number().int().positive() });

/** Irreversible — permanently removes a segment (and its reverse counterpart) already sitting in trash. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  purgeSegment(segment.id);
  logActivity(user.id, "purge", "segment", segment.id, { name: segment.name });
  return NextResponse.json({ ok: true });
}
