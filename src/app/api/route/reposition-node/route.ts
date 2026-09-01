import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute } from "@/lib/activeRoute";
import { getNode } from "@/lib/nodes";
import { moveNode } from "@/lib/segments";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { canEdit } from "@/lib/ownership";
import { haversineMeters } from "@/lib/geo";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  nodeId: z.number().int().positive(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().positive().optional(),
});

const OFF_PATH_THRESHOLD_M = 25;
const ACCURACY_BUFFER_M = 30;
const DEFAULT_ACCURACY_M = 35;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node || node.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, node.createdBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const accuracyM = parsed.data.accuracyM ?? DEFAULT_ACCURACY_M;
  const maxDist = accuracyM + ACCURACY_BUFFER_M;
  const distToGps = haversineMeters(node, { lat: parsed.data.lat, lng: parsed.data.lng });
  if (distToGps > maxDist) {
    return NextResponse.json({ error: "too_far_from_gps", maxDistM: maxDist, actualDistM: Math.round(distToGps) }, { status: 400 });
  }

  const settings = getSettings();
  const before = { lat: node.lat, lng: node.lng };
  moveNode(parsed.data.nodeId, { lat: parsed.data.lat, lng: parsed.data.lng }, effectiveWalkSpeedKmh(user.walkSpeedKmh, settings));

  const updated = getNode(parsed.data.nodeId)!;
  const moveDist = haversineMeters(before, updated);
  const offPathWarning = moveDist > OFF_PATH_THRESHOLD_M;

  logActivity(user.id, "reposition", "node", node.id, {
    name: node.name,
    moveDistM: Math.round(moveDist),
    offPathWarning,
  });

  return NextResponse.json({ ok: true, offPathWarning });
}
