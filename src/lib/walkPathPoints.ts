import type { LatLng } from "./geo";

/** Flatten segment geometry into one polyline for walk previews (skips duplicate junction points). */
export function walkPathPoints(
  segmentIds: number[],
  geometryBySegmentId: Map<number, LatLng[]>,
  fallback?: { nodeChain: number[]; coords: Map<number, LatLng> },
): LatLng[] {
  const points: LatLng[] = [];
  for (const id of segmentIds) {
    const geom = geometryBySegmentId.get(id);
    if (!geom?.length) continue;
    if (points.length === 0) points.push(...geom);
    else points.push(...geom.slice(1));
  }
  if (points.length >= 2) return points;

  if (fallback) {
    const chain = fallback.nodeChain
      .map((id) => fallback.coords.get(id))
      .filter((p): p is LatLng => p != null);
    if (chain.length >= 2) return chain;
  }
  return points;
}
