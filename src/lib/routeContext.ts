import { listSegments, isSegmentLocked } from "./segments";
import { listNodes } from "./nodes";
import { buildGraph, buildPairMap, type SegmentEdge } from "./routing";

/** Build routing edges, excluding locked segments and reverse siblings of one-way segments. */
export function filterRoutableEdges(
  segments: { id: number; reverseOf: number | null; oneWay: boolean; lockedUntil: string | null; startNodeId: number; endNodeId: number; lengthM: number; durationMin: number }[],
): SegmentEdge[] {
  const oneWayIds = new Set(segments.filter((s) => s.oneWay).map((s) => s.id));
  return segments
    .filter((s) => !isSegmentLocked(s))
    .filter((s) => !(s.reverseOf != null && oneWayIds.has(s.reverseOf)))
    .map((s) => ({
      id: s.id,
      from: s.startNodeId,
      to: s.endNodeId,
      lengthM: s.lengthM,
      durationMin: s.durationMin,
    }));
}

export function loadGraphContext() {
  const segments = listSegments();
  const nodes = listNodes();

  // Locked segments stay visible on the map/table — they just don't get picked
  // for new routes until the lock expires. One-way segments exclude their
  // reverse sibling from the graph. Everything else below (segmentsById,
  // pairOf) stays unfiltered so popups/rendering still work for them.
  const edges = filterRoutableEdges(segments);

  const graph = buildGraph(edges);
  const pairOf = buildPairMap(segments.map((s) => ({ id: s.id, reverseOf: s.reverseOf })));
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const segmentsById = new Map(segments.map((s) => [s.id, s]));

  return { graph, pairOf, nodesById, segmentsById };
}
