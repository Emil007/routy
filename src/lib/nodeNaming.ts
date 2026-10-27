import { type LatLng } from "./geo";
import { listNamePartsNear, type NamePart } from "./nameParts";
import { abbreviateStreetTypes } from "./streetAbbrev";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Routy/1.0 (self-hosted dog walk route planner)";

// Nominatim usage policy: max 1 req/s, identify yourself, cache results.
const MIN_REQUEST_INTERVAL_MS = 1100; // slightly above 1 req/s hard limit
let lastRequestAt = 0;
// Simple bounded LRU: { key -> { name, at } }; key = rounded lat,lng.
const CACHE_LIMIT = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { name: string | null; at: number }>();

/** Throttle calls to <= ~0.9 req/s (global, process-wide) and dedupe nearby points. */
async function rateLimitedFetchOsm(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.name;

  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  let name: string | null = null;
  try {
    const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    } finally {
      clearTimeout(timeout);
    }
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { address?: NominatimAddress; display_name?: string }
        | null;
      if (data) name = baseNameFromAddress(data.address ?? {}, data.display_name);
    }
  } catch {
    name = null;
  }

  cache.set(key, { name, at: Date.now() });
  if (cache.size > CACHE_LIMIT) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return name;
}

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

/**
 * Looks up a road/way/place name for `point` via OpenStreetMap reverse
 * geocoding. Purely a prefill: a nice-to-have, never a reason to block node
 * creation, so any failure (offline, timeout, no address data) returns null.
 */
async function fetchOsmBaseName(point: LatLng): Promise<string | null> {
  // Bounds safety net: reject out-of-range coordinates before any HTTP call.
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    return null;
  }
  return rateLimitedFetchOsm(point.lat, point.lng);
}

export interface NodeNameSuggestions {
  /** Full OSM road/way name for TTS and storage — not yet a stored name_part. */
  osmSpeakText: string | null;
  /** Abbreviated OSM label for UI chips and preview. */
  osmDisplayText: string | null;
  /** @deprecated Use osmSpeakText — kept for older clients. */
  osmText: string | null;
  /** Existing name_parts already used by nodes nearby — reusable "link" candidates for either slot. */
  nearbyParts: NamePart[];
}

/**
 * Suggests the raw ingredients for naming a new node: an OSM-derived name and
 * nearby reusable name parts (already used by other nodes close by), so the
 * user can pick/combine them into the node's two linked name slots instead of
 * typing everything by hand. Best-effort — empty result on any failure.
 */
export async function suggestNodeNameParts(point: LatLng): Promise<NodeNameSuggestions> {
  const osmSpeakText = await fetchOsmBaseName(point);
  const osmDisplayText = osmSpeakText ? abbreviateStreetTypes(osmSpeakText) : null;
  let nearbyParts = listNamePartsNear(point);

  // Prefer an existing nearby part when its speak text matches the OSM road.
  if (osmSpeakText) {
    const match = nearbyParts.find((p) => p.speakText === osmSpeakText);
    if (match) {
      nearbyParts = [match, ...nearbyParts.filter((p) => p.id !== match.id)];
    }
  }

  return {
    osmSpeakText,
    osmDisplayText,
    osmText: osmSpeakText,
    nearbyParts,
  };
}
