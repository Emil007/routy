import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { splitSegment, getSegment } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { segmentUsedByActiveRoute } from "@/lib/activeRoute";
import { canEdit } from "@/lib/ownership";

const endpointSchema = z.union([
  z.object({ nodeId: z.number().int().positive() }),
  z.object({ newName: z.string().trim().max(255).nullable() }),
]);

const bodySchema = z.object({
  segmentId: z.number().int().positive(),
  lat: z.number(),
  lng: z.number(),
  endpoint: endpointSchema,
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // Splitting deletes the original segment (replacing it with two new ones), which
  // would silently corrupt any active route's stored segment_ids if it depends on it.
  const segment = getSegment(parsed.data.segmentId);
  if (!segment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, segment.submittedBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const relatedIds = [segment.id, ...(segment.reverseOf !== null ? [segment.reverseOf] : [])];
  if (segmentUsedByActiveRoute(relatedIds)) {
    return NextResponse.json({ error: "segment_active" }, { status: 409 });
  }

  const settings = getSettings();
  const result = splitSegment(
    parsed.data.segmentId,
    { lat: parsed.data.lat, lng: parsed.data.lng },
    parsed.data.endpoint,
    user.id,
    effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, newNodeId: result.newNodeId });
}
