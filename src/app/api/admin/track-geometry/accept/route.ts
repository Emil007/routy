import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { acceptTrackSuggestion } from "@/lib/trackGeometry";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  walkId: z.number().int().positive(),
  segmentId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const settings = getSettings();
  const result = acceptTrackSuggestion(
    parsed.data.walkId,
    parsed.data.segmentId,
    effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  );

  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  logActivity(user.id, "edit_geometry", "segment", result.segment.id, {
    name: result.segment.name,
    source: "track_geometry_accept",
    walkId: parsed.data.walkId,
  });

  return NextResponse.json({ ok: true, segmentId: result.segment.id });
}
