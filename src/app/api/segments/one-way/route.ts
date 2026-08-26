import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { setSegmentOneWay, getSegment } from "@/lib/segments";

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  oneWay: z.boolean(),
});

/** Toggle one-way routing for a directed segment (no reason text). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment || segment.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && segment.submittedBy !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = setSegmentOneWay(parsed.data.segmentId, parsed.data.oneWay);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, segment: getSegment(parsed.data.segmentId) });
}
