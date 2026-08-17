// Pure node-proximity matching — no database dependency, safe to import from
// both server code and client components (e.g. the map-drawing UI, which
// does its own snapping against an already-fetched node list).
import { type LatLng, haversineMeters } from "./geo";

export interface MatchableNode {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
}

export interface NodeCandidate {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  distanceM: number;
}

export function findNodeCandidates<T extends MatchableNode>(
  nodes: T[],
  point: LatLng,
  radiusM: number,
): NodeCandidate[] {
  return nodes
    .map((n) => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, distanceM: haversineMeters(point, n) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Finds an existing node with the same name guess but suspiciously far away. */
export function findNameConflict<T extends MatchableNode>(
  nodes: T[],
  point: LatLng,
  nameGuess: string | null,
  warnDistanceM: number,
): NodeCandidate | null {
  if (!nameGuess) return null;
  let best: NodeCandidate | null = null;
  for (const n of nodes) {
    if (n.name === nameGuess) {
      const d = haversineMeters(point, n);
      if (d > warnDistanceM && (!best || d < best.distanceM)) {
        best = { id: n.id, name: n.name, lat: n.lat, lng: n.lng, distanceM: d };
      }
    }
  }
  return best;
}
