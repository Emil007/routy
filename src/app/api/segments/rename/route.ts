import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSegment, renameSegment } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  name: z.string().trim().max(255),
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

  renameSegment(segment.id, parsed.data.name || null);
  return NextResponse.json({ ok: true });
}
