import type { SegmentRow } from "./segments";
import type { NodeRow } from "./nodes";

export interface RouteStation {
  nodeId: number;
  name: string | null;
  lat: number;
  lng: number;
}

export interface RouteElevation {
  gainM: number;
  lossM: number;
}

export interface RouteDisplay {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  stations: RouteStation[];
  elevation: RouteElevation | null;
  geometry: [number, number][];
}

export function buildRouteDisplay(
  nodeChain: number[],
  segmentIds: number[],
  lengthM: number,
  durationMin: number,
  nodesById: Map<number, NodeRow>,
  segmentsById: Map<number, SegmentRow>,
): RouteDisplay {
  const stations = nodeChain.map((id) => {
    const node = nodesById.get(id);
    return { nodeId: id, name: node?.name ?? null, lat: node?.lat ?? 0, lng: node?.lng ?? 0 };
  });

  let hasElevation = false;
  let gainM = 0;
  let lossM = 0;
  const geometry: [number, number][] = [];

  segmentIds.forEach((segId, idx) => {
    const seg = segmentsById.get(segId);
    if (!seg) return;
    if (seg.elevation) {
      hasElevation = true;
      gainM += seg.elevation.gainM;
      lossM += seg.elevation.lossM;
    }
    const pts = idx === 0 ? seg.geometry : seg.geometry.slice(1);
    for (const p of pts) geometry.push([p.lat, p.lng]);
  });

  return {
    nodeChain,
    segmentIds,
    lengthM,
    durationMin,
    stations,
    elevation: hasElevation ? { gainM: Math.round(gainM), lossM: Math.round(lossM) } : null,
    geometry,
  };
}
