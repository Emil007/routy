import { type LatLng } from "./geo";
import { listNamePartsNear, type NamePart } from "./nameParts";
import { abbreviateStreetTypes } from "./streetAbbrev";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Routy/1.0 (self-hosted dog walk route planner)";

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

    return baseNameFromAddress(data.address ?? {}, data.display_name);
  } catch {
    return null;
  }
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
