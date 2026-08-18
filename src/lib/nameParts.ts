import { db } from "./db";
import { haversineMeters, type LatLng } from "./geo";
import type { NodeNameParts } from "./nodes";

export interface NamePart {
  id: number;
  text: string;
}

interface NamePartDbRow {
  id: number;
  text: string;
}

function mapNamePart(row: NamePartDbRow): NamePart {
  return { id: row.id, text: row.text };
}

export function getNamePart(id: number): NamePart | null {
  const row = db.prepare("SELECT id, text FROM name_parts WHERE id = ?").get(id) as NamePartDbRow | undefined;
  return row ? mapNamePart(row) : null;
}

/** Reuses an existing part with the exact same text (so shared name-part IDs — and thus route-text shortening — actually happen), or creates a new one. */
export function getOrCreateNamePart(text: string, createdBy: number | null): NamePart {
  const trimmed = text.trim();
  const existing = db.prepare("SELECT id, text FROM name_parts WHERE text = ?").get(trimmed) as
    | NamePartDbRow
    | undefined;
  if (existing) return mapNamePart(existing);

  const info = db.prepare("INSERT INTO name_parts (text, created_by) VALUES (?, ?)").run(trimmed, createdBy);
  return { id: Number(info.lastInsertRowid), text: trimmed };
}

// Tight on purpose — this is meant to surface the handful of parts already used by
// genuinely adjacent junctions (the next one or two along the path), not every part
// anywhere in the general area. A wider radius buried the useful suggestions in noise.
const NEARBY_PART_RADIUS_M = 250;
const NEARBY_PART_LIMIT = 8;

/** Name parts already used by nodes near `point` — the "link to an existing part" suggestions. */
export function listNamePartsNear(point: LatLng): NamePart[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT np.id as id, np.text as text, n.lat as lat, n.lng as lng
       FROM nodes n
       JOIN name_parts np ON np.id = n.name_part_1_id OR np.id = n.name_part_2_id
       WHERE n.name_part_1_id IS NOT NULL OR n.name_part_2_id IS NOT NULL`,
    )
    .all() as (NamePartDbRow & { lat: number; lng: number })[];

  const seen = new Map<number, { part: NamePart; distanceM: number }>();
  for (const row of rows) {
    const distanceM = haversineMeters(point, { lat: row.lat, lng: row.lng });
    if (distanceM > NEARBY_PART_RADIUS_M) continue;
    const existing = seen.get(row.id);
    if (!existing || distanceM < existing.distanceM) {
      seen.set(row.id, { part: mapNamePart(row), distanceM });
    }
  }
  return [...seen.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, NEARBY_PART_LIMIT)
    .map((x) => x.part);
}

/**
 * Turns the two free-text slots from the naming UI into a display name plus
 * the linked name_part bookkeeping — the single place that decides how a
 * node's `name` string and its `name_part_*_id` columns relate. `getOrCreateNamePart`
 * dedupes by exact text, so retyping a part someone already used elsewhere
 * links to the same row automatically, no client-side id-tracking needed.
 */
export function resolveNamePartsInput(
  part1: string,
  part2: string,
  separator: string,
  createdBy: number | null,
): { name: string | null; nameParts?: NodeNameParts } {
  const p1 = part1.trim();
  const p2 = part2.trim();
  if (!p1 && !p2) return { name: null };
  if (!p2) {
    const part = getOrCreateNamePart(p1, createdBy);
    return { name: p1, nameParts: { part1Id: part.id, part2Id: null, separator } };
  }
  if (!p1) {
    const part = getOrCreateNamePart(p2, createdBy);
    return { name: p2, nameParts: { part1Id: part.id, part2Id: null, separator } };
  }
  const part1Row = getOrCreateNamePart(p1, createdBy);
  const part2Row = getOrCreateNamePart(p2, createdBy);
  return { name: `${p1}${separator}${p2}`, nameParts: { part1Id: part1Row.id, part2Id: part2Row.id, separator } };
}
