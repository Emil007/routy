import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { updateSegmentGeometry, getSegment } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const pointSchema = z.object({ lat: z.number(), lng: z.number(), ele: z.number().optional() });
// M1-13/F05: unbounded geometry holds the SQLite write lock and is served to every
// account — cap at 20k points (413) before touching anything.
const MAX_GEOMETRY_POINTS = 20_000;
const MAX_GEOMETRY_POINTS_MSG = `too_many_points (max ${MAX_GEOMETRY_POINTS})`;
const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  points: z.array(pointSchema).min(2).max(MAX_GEOMETRY_POINTS, MAX_GEOMETRY_POINTS_MSG),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  if (parsed.data.points.length > MAX_GEOMETRY_POINTS) {
    return NextResponse.json({ error: "too_many_points" }, { status: 413 });
  }

  const segment = getSegment(parsed.data.segmentId);
  if (!segment || segment.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const settings = getSettings();
  const result = updateSegmentGeometry(
    parsed.data.segmentId,
    parsed.data.points,
    effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  logActivity(user.id, "edit_geometry", "segment", segment.id, { name: segment.name });
  return NextResponse.json({ ok: true });
}
