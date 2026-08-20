import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createNode, getNode, setUserHomeNode, findNodeCandidates, type NodeRow } from "@/lib/nodes";
import { createSegmentWithReverse, getSegment } from "@/lib/segments";
import { resolveNamePartsInput } from "@/lib/nameParts";
import { getSettings } from "@/lib/settings";
import { elevationStats, type LatLng } from "@/lib/geo";
import { attachElevation } from "@/lib/elevation";
import { logActivity } from "@/lib/activityLog";
import { detectProposalsFromTrack } from "@/lib/discovery";
import { db } from "@/lib/db";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { getClientIp } from "@/lib/loginRateLimit";

const pointSchema = z.object({ lat: z.number(), lng: z.number(), ele: z.number().optional() });

const endpointSchema = z.union([
  z.object({ nodeId: z.number().int().positive() }),
  z.object({
    part1: z.string().trim().max(255).default(""),
    part2: z.string().trim().max(255).default(""),
  }),
]);

const elevationSchema = z
  .object({ gainM: z.number(), lossM: z.number(), minM: z.number(), maxM: z.number() })
  .nullable();

const trackSchema = z.object({
  points: z.array(pointSchema).min(2).max(20_000),
  lengthM: z.number().int().nonnegative(),
  durationMin: z.number().int().nonnegative(),
  elevation: elevationSchema,
  start: endpointSchema,
  end: endpointSchema,
  markStartAsHome: z.boolean().optional(),
  source: z.enum(["gpx", "drawn"]).default("gpx"),
});

const bodySchema = z.object({ tracks: z.array(trackSchema).min(1).max(50) });

type PreparedTrack = {
  track: z.infer<typeof trackSchema>;
  points: z.infer<typeof pointSchema>[];
  elevation: z.infer<typeof elevationSchema>;
  startPoint: LatLng;
  endPoint: LatLng;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = user.id;

  const rate = checkApiRateLimit("gpx_commit", { userId, ip: await getClientIp() });
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  let totalPoints = 0;
  for (const track of parsed.data.tracks) {
    totalPoints += track.points.length;
  }
  if (totalPoints > 50_000) {
    return NextResponse.json({ error: "too_many_points", maxTotal: 50_000 }, { status: 400 });
  }

  const settings = getSettings();
  const prepared: PreparedTrack[] = [];

  for (const track of parsed.data.tracks) {
    const startPoint = track.points[0];
    const endPoint = track.points[track.points.length - 1];

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

    prepared.push({
      track,
      points,
      elevation,
      startPoint,
      endPoint,
    });
  }

  try {
    const saved = db.transaction(() => {
      const createdThisBatch: NodeRow[] = [];

      function resolveEndpoint(endpoint: { nodeId: number } | { part1: string; part2: string }, point: LatLng): number | null {
        if ("nodeId" in endpoint) {
          const node = getNode(endpoint.nodeId);
          return node && !node.deletedAt ? node.id : null;
        }
        const nearby = findNodeCandidates(createdThisBatch, point, settings.merge_radius_m)[0];
        if (nearby) return nearby.id;
        const { name, nameParts } = resolveNamePartsInput(endpoint.part1, endpoint.part2, "/", userId);
        const created = createNode(name, point, false, userId, nameParts);
        createdThisBatch.push(created);
        logActivity(userId, "create", "node", created.id, { name: created.name });
        return created.id;
      }

      let count = 0;
      for (const { track, points, elevation, startPoint, endPoint } of prepared) {
        const startNodeId = resolveEndpoint(track.start, startPoint);
        if (startNodeId === null) throw new Error("unknown_start_node");

        const endNodeId = resolveEndpoint(track.end, endPoint);
        if (endNodeId === null) throw new Error("unknown_end_node");

        if (track.markStartAsHome) {
          setUserHomeNode(user.id, startNodeId);
          const homeNode = getNode(startNodeId);
          logActivity(user.id, "set_home", "node", startNodeId, { name: homeNode?.name ?? null });
        }

        const { forwardId } = createSegmentWithReverse({
          startNodeId,
          endNodeId,
          points,
          lengthM: track.lengthM,
          durationMin: track.durationMin,
          elevation,
          source: track.source,
          submittedBy: user.id,
        });
        const created = getSegment(forwardId);
        logActivity(user.id, track.source === "drawn" ? "create" : "gpx_commit", "segment", forwardId, {
          name: created?.name ?? null,
          source: track.source,
        });
        detectProposalsFromTrack(points, user.id);
        count++;
      }
      return count;
    })();

    return NextResponse.json({ saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "commit_failed";
    if (message === "unknown_start_node") return NextResponse.json({ error: "unknown_start_node" }, { status: 400 });
    if (message === "unknown_end_node") return NextResponse.json({ error: "unknown_end_node" }, { status: 400 });
    throw err;
  }
}
