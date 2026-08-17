import { listSegments } from "./segments";
import { listNodes } from "./nodes";
import { buildGraph, buildPairMap, type SegmentEdge } from "./routing";

export function loadGraphContext() {
  const segments = listSegments();
  const nodes = listNodes();

  const edges: SegmentEdge[] = segments.map((s) => ({
    id: s.id,
    from: s.startNodeId,
    to: s.endNodeId,
    lengthM: s.lengthM,
    durationMin: s.durationMin,
  }));

  const graph = buildGraph(edges);
  const pairOf = buildPairMap(segments.map((s) => ({ id: s.id, reverseOf: s.reverseOf })));
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const segmentsById = new Map(segments.map((s) => [s.id, s]));

  return { graph, pairOf, nodesById, segmentsById };
}
