import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createNode, getNode, setHomeNode, listNodes, findNodeCandidates, type NodeRow } from "@/lib/nodes";
import { createSegmentWithReverse } from "@/lib/segments";
import { getSettings } from "@/lib/settings";
import type { LatLng } from "@/lib/geo";

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
  // Keep a running list so later tracks in this same commit snap onto nodes that
  // earlier tracks in the *same* batch just created, instead of duplicating them.
  const knownNodes: NodeRow[] = listNodes();

  function resolveEndpoint(
    endpoint: { nodeId: number } | { newName: string | null },
    point: LatLng,
  ): number | null {
    if ("nodeId" in endpoint) {
      const node = getNode(endpoint.nodeId);
      return node ? node.id : null;
    }
    const nearby = findNodeCandidates(knownNodes, point, settings.merge_radius_m)[0];
    if (nearby) return nearby.id;
    const created = createNode(endpoint.newName, point);
    knownNodes.push(created);
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

    createSegmentWithReverse({
      startNodeId,
      endNodeId,
      points: track.points,
      lengthM: track.lengthM,
      durationMin: track.durationMin,
      elevation: track.elevation,
      source: track.source,
      submittedBy: user.id,
    });
    saved++;
  }

  return NextResponse.json({ saved });
}
