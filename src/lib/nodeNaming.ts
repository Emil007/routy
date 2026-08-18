import { bearing, haversineMeters, type LatLng } from "./geo";
import { listNodes } from "./nodes";
import { t, type Locale } from "./i18n";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Routy/1.0 (self-hosted dog walk route planner)";

// A forest or field name applies over a wide area, so we look for an existing
// node sharing that name much further out than the merge radius (which is
// only meant for "same physical point").
const SAME_NAME_SEARCH_RADIUS_M = 3000;

const ADDRESS_KEYS = [
  "road",
  "pedestrian",
  "footway",
  "path",
  "forest",
  "wood",
  "natural",
  "hamlet",
  "suburb",
  "village",
  "neighbourhood",
] as const;

interface NominatimAddress {
  [key: string]: string | undefined;
}

function baseNameFromAddress(address: NominatimAddress, displayName: string | undefined): string | null {
  for (const key of ADDRESS_KEYS) {
    const value = address[key];
    if (value) return value;
  }
  if (displayName) {
    const first = displayName.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

const COMPASS_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

function compassLabel(deg: number, locale: Locale): string {
  const index = Math.round(deg / 45) % 8;
  return t(locale, `nodeNaming.directions.${COMPASS_KEYS[index]}`);
}

/**
 * Suggests a name for a new node via OpenStreetMap reverse geocoding, with a
 * compass-direction suffix if an existing node already uses that name nearby
 * (e.g. "Kasernenwald" -> "Kasernenwald Nordost"). Purely a prefill: a nice-to-
 * have, never a reason to block node creation, so any failure (offline,
 * timeout, no address data) simply returns null.
 */
export async function suggestNodeName(point: LatLng, locale: Locale): Promise<string | null> {
  try {
    const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${point.lat}&lon=${point.lng}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as
      | { address?: NominatimAddress; display_name?: string }
      | null;
    if (!data) return null;

    const baseName = baseNameFromAddress(data.address ?? {}, data.display_name);
    if (!baseName) return null;

    const sameNamed = listNodes()
      .filter((n) => n.name?.startsWith(baseName))
      .map((n) => ({ node: n, distanceM: haversineMeters(n, point) }))
      .filter((x) => x.distanceM <= SAME_NAME_SEARCH_RADIUS_M)
      .sort((a, b) => a.distanceM - b.distanceM);

    if (sameNamed.length === 0) return baseName;

    const dir = compassLabel(bearing(sameNamed[0].node, point), locale);
    return `${baseName} ${dir}`;
  } catch {
    return null;
  }
}
