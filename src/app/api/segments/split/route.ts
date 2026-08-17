import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { splitSegment } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";

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
