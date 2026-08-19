import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { listAvoidSegmentIds, addAvoidSegment, removeAvoidSegment } from "@/lib/avoidList";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ segmentIds: listAvoidSegmentIds(user.id) });
}

const bodySchema = z.object({ segmentId: z.number().int().positive() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!addAvoidSegment(user.id, parsed.data.segmentId)) {
    return NextResponse.json({ error: "segment_not_found" }, { status: 404 });
  }
  return NextResponse.json({ segmentIds: listAvoidSegmentIds(user.id) });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  removeAvoidSegment(user.id, parsed.data.segmentId);
  return NextResponse.json({ segmentIds: listAvoidSegmentIds(user.id) });
}
