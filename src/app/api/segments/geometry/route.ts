import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { updateSegmentGeometry, getSegment } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { canEdit } from "@/lib/ownership";

const pointSchema = z.object({ lat: z.number(), lng: z.number(), ele: z.number().optional() });
const bodySchema = z.object({ segmentId: z.number().int().positive(), points: z.array(pointSchema).min(2) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const segment = getSegment(parsed.data.segmentId);
  if (!segment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const settings = getSettings();
  const result = updateSegmentGeometry(
    parsed.data.segmentId,
    parsed.data.points,
    effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
