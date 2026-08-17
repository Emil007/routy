export interface LatLng {
  lat: number;
  lng: number;
  ele?: number;
}

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const sinPhi = Math.sin(dPhi / 2);
  const sinLambda = Math.sin(dLambda / 2);
  const h = sinPhi * sinPhi + Math.cos(phi1) * Math.cos(phi2) * sinLambda * sinLambda;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function pathLengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

export function estimateMinutes(lengthM: number, walkSpeedKmh: number): number {
  const speed = walkSpeedKmh > 0 ? walkSpeedKmh : 5;
  return Math.round((lengthM / 1000 / speed) * 60);
}

export interface ElevationStats {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
}

export function elevationStats(points: LatLng[]): ElevationStats | null {
  const eles = points.map((p) => p.ele).filter((e): e is number => typeof e === "number" && !Number.isNaN(e));
  if (eles.length < 2) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < eles.length; i++) {
    const diff = eles[i] - eles[i - 1];
    if (diff > 0) gain += diff;
    else loss += -diff;
  }
  return {
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    minM: Math.round(Math.min(...eles)),
    maxM: Math.round(Math.max(...eles)),
  };
}

export function reversePoints(points: LatLng[]): LatLng[] {
  return [...points].reverse();
}

/** Initial compass bearing (0-360°) of travel from `a` to `b`. */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

/** Smallest angle (0-180°) between two compass bearings. */
export function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Small-scale (tens to hundreds of meters) local projection — accurate enough for
// finding where on a walking path a point falls, without pulling in a full
// geodesy library.
function equirectangularXY(ref: LatLng, p: LatLng): [number, number] {
  const latRad = (ref.lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  return [(p.lng - ref.lng) * mPerDegLng, (p.lat - ref.lat) * mPerDegLat];
}

function fromEquirectangularXY(ref: LatLng, x: number, y: number): LatLng {
  const latRad = (ref.lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  return { lat: ref.lat + y / mPerDegLat, lng: ref.lng + x / mPerDegLng };
}

export interface ClosestPointResult {
  point: LatLng;
  /** The point lies on the edge between path[index] and path[index + 1]. */
  index: number;
  distanceM: number;
}

/** Finds the closest point lying anywhere on the polyline `path` (not just its vertices) to `query`. */
export function closestPointOnPath(path: LatLng[], query: LatLng): ClosestPointResult | null {
  if (path.length < 2) return null;
  let best: ClosestPointResult | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const [bx, by] = equirectangularXY(a, b);
    const [px, py] = equirectangularXY(a, query);
    const lenSq = bx * bx + by * by;
    let t = lenSq > 0 ? (px * bx + py * by) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const point = fromEquirectangularXY(a, t * bx, t * by);
    if (typeof a.ele === "number" && typeof b.ele === "number") point.ele = a.ele + t * (b.ele - a.ele);
    const distanceM = haversineMeters(point, query);
    if (!best || distanceM < best.distanceM) best = { point, index: i, distanceM };
  }
  return best;
}
