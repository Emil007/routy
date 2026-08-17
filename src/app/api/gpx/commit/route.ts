import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createNode, getNode, setHomeNode, findNodeCandidates, type NodeRow } from "@/lib/nodes";
import { createSegmentWithReverse } from "@/lib/segments";
import { getSettings } from "@/lib/settings";
import { elevationStats, type LatLng } from "@/lib/geo";
import { attachElevation } from "@/lib/elevation";

const pointSchema = z.object({ lat: z.number(), lng: z.number(), ele: z.number().optional() });

const endpointSchema = z.union([
  z.object({ nodeId: z.number().int().positive() }),
  z.object({ newName: z.string().trim().max(255).nullable() }),
]);

const elevationSchema = z
  .object({ gainM: z.number(), lossM: z.number(), minM: z.number(), maxM: z.number() })
  .nullable();

const trackSchema = z.object({
  points: z.array(pointSchema).min(2),
  lengthM: z.number().int().nonnegative(),
  durationMin: z.number().int().nonnegative(),
  elevation: elevationSchema,
  start: endpointSchema,
  end: endpointSchema,
  markStartAsHome: z.boolean().optional(),
  source: z.enum(["gpx", "drawn"]).default("gpx"),
});

const bodySchema = z.object({ tracks: z.array(trackSchema).min(1).max(50) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const settings = getSettings();
  // Tracks in the same upload often share an endpoint (that's the whole point of a
  // batch import) even though none of those nodes existed yet when /gpx/parse ran.
  // Keep a running list of nodes created *within this same commit* so later tracks
  // snap onto them instead of duplicating them. This must NOT include pre-existing
  // nodes: when the client explicitly says "create a new node" (a `newName`
  // endpoint), that choice was already made in the UI — usually after showing the
  // user any nearby existing node and letting them decide against reusing it — so
  // silently reusing a pre-existing node here would discard that decision and the
  // name they typed.
  const createdThisBatch: NodeRow[] = [];

  function resolveEndpoint(
    endpoint: { nodeId: number } | { newName: string | null },
    point: LatLng,
  ): number | null {
    if ("nodeId" in endpoint) {
      const node = getNode(endpoint.nodeId);
      return node ? node.id : null;
    }
    const nearby = findNodeCandidates(createdThisBatch, point, settings.merge_radius_m)[0];
    if (nearby) return nearby.id;
    const created = createNode(endpoint.newName, point);
    createdThisBatch.push(created);
    return created.id;
  }

  let saved = 0;
  for (const track of parsed.data.tracks) {
    const startPoint = track.points[0];
    const endPoint = track.points[track.points.length - 1];

    const startNodeId = resolveEndpoint(track.start, startPoint);
    if (startNodeId === null) return NextResponse.json({ error: "unknown_start_node" }, { status: 400 });

    const endNodeId = resolveEndpoint(track.end, endPoint);
    if (endNodeId === null) return NextResponse.json({ error: "unknown_end_node" }, { status: 400 });

    if (track.markStartAsHome) setHomeNode(startNodeId);

    // GPX tracks usually carry recorded elevation already; drawn paths never do
    // (a map click has no altitude). Either way, if it's missing, look it up —
    // best-effort, never blocks the save if the lookup fails or times out.
    let points = track.points;
    let elevation = track.elevation;
    if (!elevation) {
      const withElevation = await attachElevation(points);
      const computed = elevationStats(withElevation);
      if (computed) {
        points = withElevation;
        elevation = computed;
      }
    }

    createSegmentWithReverse({
      startNodeId,
      endNodeId,
      points,
      lengthM: track.lengthM,
      durationMin: track.durationMin,
      elevation,
      source: track.source,
      submittedBy: user.id,
    });
    saved++;
  }

  return NextResponse.json({ saved });
}
