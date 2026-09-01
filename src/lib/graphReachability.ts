import type { Graph } from "./routing";

/** Undirected reachability from `homeNodeId` on the active segment graph. */
export function reachableNodeIds(graph: Graph, homeNodeId: number | null): Set<number> {
  const reachable = new Set<number>();
  if (homeNodeId == null) return reachable;
  const undirected = new Map<number, number[]>();
  for (const [from, edges] of graph.adjacency) {
    if (!undirected.has(from)) undirected.set(from, []);
    for (const e of edges) {
      undirected.get(from)!.push(e.to);
      if (!undirected.has(e.to)) undirected.set(e.to, []);
      undirected.get(e.to)!.push(from);
    }
  }
  const queue = [homeNodeId];
  reachable.add(homeNodeId);
  while (queue.length > 0) {
    const n = queue.pop()!;
    for (const next of undirected.get(n) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return reachable;
}

/** Canonical segment ids whose endpoints are not both reachable from home. */
export function disconnectedCanonicalSegmentIds(
  graph: Graph,
  homeNodeId: number | null,
  canonicalSegmentIds: number[],
  segmentEndpoints: Map<number, { startNodeId: number; endNodeId: number }>,
): number[] {
  const nodes = reachableNodeIds(graph, homeNodeId);
  if (nodes.size === 0) return canonicalSegmentIds;
  return canonicalSegmentIds.filter((id) => {
    const seg = segmentEndpoints.get(id);
    if (!seg) return false;
    return !nodes.has(seg.startNodeId) || !nodes.has(seg.endNodeId);
  });
}
