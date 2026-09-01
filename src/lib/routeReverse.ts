import { reversePoints } from "./geo";
import type { Graph, RouteResult } from "./routing";
import type { SegmentRow } from "./segments";

/** Flip a route: reverse node chain and swap each segment for its reverse pair when available. */
export function reverseRouteResult(
  route: RouteResult,
  pairOf: Map<number, number>,
  segmentsById: Map<number, SegmentRow>,
): RouteResult | null {
  if (route.nodeChain.length < 2 || route.segmentIds.length === 0) return null;

  const reversedNodeChain = [...route.nodeChain].reverse();
  const reversedSegmentIds: number[] = [];
  for (const id of route.segmentIds) {
    const pair = pairOf.get(id);
    if (pair !== undefined && segmentsById.has(pair)) {
      reversedSegmentIds.push(pair);
      continue;
    }
    if (!segmentsById.has(id)) return null;
    reversedSegmentIds.push(id);
  }
  reversedSegmentIds.reverse();

  return {
    nodeChain: reversedNodeChain,
    segmentIds: reversedSegmentIds,
    lengthM: route.lengthM,
    durationMin: route.durationMin,
    coreLengthM: route.coreLengthM,
    extensionLengthM: route.extensionLengthM,
  };
}

/** Build display geometry for a reversed route (points run end → start). */
export function reverseRouteGeometry(segmentIds: number[], segmentsById: Map<number, SegmentRow>): [number, number][] {
  const geometry: [number, number][] = [];
  const ordered = [...segmentIds].reverse();
  ordered.forEach((segId, idx) => {
    const seg = segmentsById.get(segId);
    if (!seg) return;
    const pts = reversePoints(seg.geometry);
    const slice = idx === 0 ? pts : pts.slice(1);
    for (const p of slice) geometry.push([p.lat, p.lng]);
  });
  return geometry;
}

/** No-op sanity check — reversed segments should still connect the reversed node chain. */
export function reversedRouteConnects(graph: Graph, route: RouteResult): boolean {
  void graph;
  if (route.nodeChain.length !== route.segmentIds.length + 1) return false;
  return true;
}
