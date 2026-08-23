import { db } from "./db";
import { haversineMeters, type LatLng } from "./geo";
import type { NodeNameParts, NodeRow } from "./nodes";
import { abbreviateStreetTypes } from "./streetAbbrev";

export { abbreviateStreetTypes } from "./streetAbbrev";

export interface NamePart {
  id: number;
  /** Abbreviated label for UI — mirrors legacy `text`. */
  text: string;
  displayText: string;
  speakText: string;
}

interface NamePartDbRow {
  id: number;
  text: string;
  display_text: string | null;
  speak_text: string | null;
}

function mapNamePart(row: NamePartDbRow): NamePart {
  const displayText = row.display_text ?? row.text;
  const speakText = row.speak_text ?? row.text;
  return { id: row.id, text: displayText, displayText, speakText };
}

const NAME_PART_SELECT = "SELECT id, text, display_text, speak_text FROM name_parts";

function composePartName(
  part1Id: number | null,
  part2Id: number | null,
  separator: string,
  field: "displayText" | "speakText",
): string | null {
  if (!part1Id && !part2Id) return null;
  const p1 = part1Id ? getNamePart(part1Id) : null;
  const p2 = part2Id ? getNamePart(part2Id) : null;
  const t1 = p1?.[field] ?? null;
  const t2 = p2?.[field] ?? null;
  if (t1 && t2) return `${t1}${separator}${t2}`;
  return t1 ?? t2;
}

/** UI label for a node — abbreviated part text when linked, else stored name. */
export function getDisplayName(
  node: Pick<NodeRow, "name" | "namePart1Id" | "namePart2Id" | "nameSeparator">,
): string | null {
  const composed = composePartName(node.namePart1Id, node.namePart2Id, node.nameSeparator, "displayText");
  if (composed) return composed;
  return node.name;
}

/** Full spoken label for TTS — unabbreviated part text when linked. */
export function getSpeakName(
  node: Pick<NodeRow, "name" | "namePart1Id" | "namePart2Id" | "nameSeparator">,
): string | null {
  const composed = composePartName(node.namePart1Id, node.namePart2Id, node.nameSeparator, "speakText");
  if (composed) return composed;
  return node.name;
}

export function getNamePart(id: number): NamePart | null {
  const row = db.prepare(`${NAME_PART_SELECT} WHERE id = ?`).get(id) as NamePartDbRow | undefined;
  return row ? mapNamePart(row) : null;
}

/** Reuses an existing part with the same speak text, else same display text. */
export function getOrCreateNamePart(speakText: string, createdBy: number | null): NamePart {
  const speak = speakText.trim();
  const display = abbreviateStreetTypes(speak);

  const bySpeak = db.prepare(`${NAME_PART_SELECT} WHERE speak_text = ?`).get(speak) as NamePartDbRow | undefined;
  if (bySpeak) return mapNamePart(bySpeak);

  const byDisplay = db.prepare(`${NAME_PART_SELECT} WHERE text = ? OR display_text = ?`).get(display, display) as
    | NamePartDbRow
    | undefined;
  if (byDisplay) return mapNamePart(byDisplay);

  const info = db
    .prepare("INSERT INTO name_parts (text, display_text, speak_text, created_by) VALUES (?, ?, ?, ?)")
    .run(display, display, speak, createdBy);
  return { id: Number(info.lastInsertRowid), text: display, displayText: display, speakText: speak };
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
      `SELECT DISTINCT np.id as id, np.text as text, np.display_text as display_text, np.speak_text as speak_text,
              n.lat as lat, n.lng as lng
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
 * dedupes by speak text, so retyping a part someone already used elsewhere
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
    return { name: part.displayText, nameParts: { part1Id: part.id, part2Id: null, separator } };
  }
  if (!p1) {
    const part = getOrCreateNamePart(p2, createdBy);
    return { name: part.displayText, nameParts: { part1Id: part.id, part2Id: null, separator } };
  }
  const part1Row = getOrCreateNamePart(p1, createdBy);
  const part2Row = getOrCreateNamePart(p2, createdBy);
  return {
    name: `${part1Row.displayText}${separator}${part2Row.displayText}`,
    nameParts: { part1Id: part1Row.id, part2Id: part2Row.id, separator },
  };
}
