import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createFreeRoamSession, reachableNeighbours, nearestNodeId, FREE_ROAM_START_RADIUS_M } from "@/lib/freeRoam";
import { listNodes } from "@/lib/nodes";
import { FREE_ROAM_POINTS_MULTIPLIER } from "@/lib/points";

const bodySchema = z.object({
  /** GPS position where the walk starts (used to pick the nearest node). */
  lat: z.number(),
  lng: z.number(),
  /** Optional explicit start node (overrides "nearest to position"). */
  startNodeId: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const { lat, lng, startNodeId } = parsed.data;

  const nodes = listNodes();
  if (startNodeId != null && !nodes.some((n) => n.id === startNodeId)) {
    return NextResponse.json({ error: "unknown_node" }, { status: 400 });
  }

  const token = createFreeRoamSession(user.id, { lat, lng }, startNodeId ?? null);

  // Determine the effective starting node (explicit wins, else nearest within radius).
  // Uses the same haversine/radius helper as session creation, so the session and
  // the response can never disagree about the start node.
  let effectiveStart: number | null = startNodeId ?? null;
  if (effectiveStart == null) {
    effectiveStart = nearestNodeId({ lat, lng }, nodes, FREE_ROAM_START_RADIUS_M);
  }

  const seedReachable = effectiveStart != null ? reachableNeighbours(effectiveStart) : [];

  return NextResponse.json({
    token,
    startNodeId: effectiveStart,
    startReachable: seedReachable,
    freeRoam: true,
    pointsMultiplier: FREE_ROAM_POINTS_MULTIPLIER,
  });
}
