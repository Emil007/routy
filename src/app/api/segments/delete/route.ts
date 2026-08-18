import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSegment, deleteSegment } from "@/lib/segments";
import { segmentUsedByActiveRoute } from "@/lib/activeRoute";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ segmentId: z.number().int().positive() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const relatedIds = [segment.id, ...(segment.reverseOf !== null ? [segment.reverseOf] : [])];
  if (segmentUsedByActiveRoute(relatedIds)) return NextResponse.json({ error: "segment_active" }, { status: 409 });

  deleteSegment(segment.id);
  logActivity(user.id, "delete", "segment", segment.id, { name: segment.name });
  return NextResponse.json({ ok: true });
}
