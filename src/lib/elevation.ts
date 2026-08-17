import type { LatLng } from "./geo";

const ELEVATION_ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const MAX_POINTS_PER_REQUEST = 100;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Looks up elevation for each point via the free Open-Meteo elevation API
 * (no key required) and returns a new array with `ele` filled in. Elevation is
 * a nice-to-have, never a reason to fail saving a path: any problem (offline,
 * timeout, unexpected response, rate limit) makes this return the original
 * points unchanged rather than throwing.
 */
export async function attachElevation(points: LatLng[]): Promise<LatLng[]> {
  if (points.length === 0) return points;

  try {
    const elevations: number[] = [];
    for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
      const chunk = points.slice(i, i + MAX_POINTS_PER_REQUEST);
      const latitude = chunk.map((p) => p.lat).join(",");
      const longitude = chunk.map((p) => p.lng).join(",");
      const url = `${ELEVATION_ENDPOINT}?latitude=${latitude}&longitude=${longitude}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) return points;

      const data = (await res.json().catch(() => null)) as { elevation?: unknown } | null;
      if (!data || !Array.isArray(data.elevation) || data.elevation.length !== chunk.length) return points;
      for (const e of data.elevation) {
        if (typeof e !== "number") return points;
        elevations.push(e);
      }
    }
    return points.map((p, i) => ({ ...p, ele: elevations[i] }));
  } catch {
    return points;
  }
}
