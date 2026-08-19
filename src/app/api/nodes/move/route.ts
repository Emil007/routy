import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode } from "@/lib/nodes";
import { moveNode } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ nodeId: z.number().int().positive(), lat: z.number(), lng: z.number() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node || node.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, node.createdBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const settings = getSettings();
  const result = moveNode(
    parsed.data.nodeId,
    { lat: parsed.data.lat, lng: parsed.data.lng },
    effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  );
  logActivity(user.id, "move", "node", node.id, { name: node.name, touchedSegments: result.touchedSegments });
  return NextResponse.json({ ok: true, touchedSegments: result.touchedSegments });
}
