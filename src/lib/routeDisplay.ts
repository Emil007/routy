import { isCanonicalSegment, type SegmentRow } from "./segments";
import type { NodeRow } from "./nodes";
import { getNamePart } from "./nameParts";

export interface RouteStation {
  nodeId: number;
  name: string | null;
  lat: number;
  lng: number;
  namePart1Id: number | null;
  namePart2Id: number | null;
  nameSeparator: string;
  /** Set when the segment leading into this station has a sibling connecting the same two
   * nodes (e.g. "geradeaus" vs "hintenrum") and a name was assigned to disambiguate it. */
  viaSegmentName: string | null;
}

export interface RouteElevation {
  gainM: number;
  lossM: number;
}

export interface ShortStationGroup {
  text: string;
  /** Set when this group was reached via a segment that needed disambiguation from a
   * sibling connecting the same two nodes — the UI renders this as a localized "(via …)". */
  viaSegmentName: string | null;
}

export interface RouteDisplay {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  stations: RouteStation[];
  /** Mechanically shortened station groups: consecutive stations sharing an identical
   * name_part id are merged into one group (shared part shown once). Never a guess —
   * falls back to each station's full name whenever nothing is actually shared. Kept as
   * a plain-text array (no baked-in "via" phrasing) so the client can localize it. */
  shortStationGroups: ShortStationGroup[];
  elevation: RouteElevation | null;
  geometry: [number, number][];
}

/** Other canonical segments connecting the exact same two nodes (either direction), computed
 * from an already-loaded segment map instead of hitting the DB again per segment. */
function findSiblingSegments(segment: SegmentRow, segmentsById: Map<number, SegmentRow>): SegmentRow[] {
  const siblings: SegmentRow[] = [];
  for (const s of segmentsById.values()) {
    if (!isCanonicalSegment(s)) continue;
    if (s.id === segment.id || s.id === segment.reverseOf) continue;
    const sameDirection = s.startNodeId === segment.startNodeId && s.endNodeId === segment.endNodeId;
    const oppositeDirection = s.startNodeId === segment.endNodeId && s.endNodeId === segment.startNodeId;
    if (sameDirection || oppositeDirection) siblings.push(s);
  }
  return siblings;
}

function stationFullText(station: RouteStation): string {
  return station.name || `#${station.nodeId}`;
}

/**
 * Mechanical shortening: walk the stations in order and, whenever a station shares an
 * identical name_part id with the previous one, merge it into the current group (showing
 * only the differing part). Groups are joined with " › " as before. Never interprets text —
 * only compares stored name_part ids — so a station without linked parts is always shown
 * in full, never guessed at.
 */
function buildShortStationGroups(stations: RouteStation[]): ShortStationGroup[] {
  if (stations.length === 0) return [];

  const partTextCache = new Map<number, string | null>();
  function partText(id: number): string | null {
    if (!partTextCache.has(id)) partTextCache.set(id, getNamePart(id)?.text ?? null);
    return partTextCache.get(id) ?? null;
  }

  const groups: ShortStationGroup[] = [];
  let groupText = stationFullText(stations[0]);
  let groupVia: string | null = null;
  let lastPart1 = stations[0].namePart1Id;
  let lastPart2 = stations[0].namePart2Id;

  for (let i = 1; i < stations.length; i++) {
    const s = stations[i];
    const sharesViaPart1 = s.namePart1Id !== null && (s.namePart1Id === lastPart1 || s.namePart1Id === lastPart2);
    const sharesViaPart2 = s.namePart2Id !== null && (s.namePart2Id === lastPart1 || s.namePart2Id === lastPart2);

    let merged = false;
    if (sharesViaPart1 && s.namePart2Id !== null) {
      const text = partText(s.namePart2Id);
      if (text) {
        groupText += s.nameSeparator + text;
        merged = true;
      }
    } else if (sharesViaPart2 && s.namePart1Id !== null) {
      const text = partText(s.namePart1Id);
      if (text) {
        groupText += s.nameSeparator + text;
        merged = true;
      }
    }

    if (!merged) {
      groups.push({ text: groupText, viaSegmentName: groupVia });
      groupText = stationFullText(s);
      groupVia = null;
    }
    lastPart1 = s.namePart1Id;
    lastPart2 = s.namePart2Id;

    if (s.viaSegmentName) groupVia = s.viaSegmentName;
  }
  groups.push({ text: groupText, viaSegmentName: groupVia });
  return groups;
}

export function buildRouteDisplay(
  nodeChain: number[],
  segmentIds: number[],
  lengthM: number,
  durationMin: number,
  nodesById: Map<number, NodeRow>,
  segmentsById: Map<number, SegmentRow>,
): RouteDisplay {
  const stations: RouteStation[] = nodeChain.map((id, idx) => {
    const node = nodesById.get(id);
    const arrivingSegment = idx > 0 ? segmentsById.get(segmentIds[idx - 1]) : undefined;
    const viaSegmentName =
      arrivingSegment && arrivingSegment.name && findSiblingSegments(arrivingSegment, segmentsById).length > 0
        ? arrivingSegment.name
        : null;
    return {
      nodeId: id,
      name: node?.name ?? null,
      lat: node?.lat ?? 0,
      lng: node?.lng ?? 0,
      namePart1Id: node?.namePart1Id ?? null,
      namePart2Id: node?.namePart2Id ?? null,
      nameSeparator: node?.nameSeparator ?? "/",
      viaSegmentName,
    };
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
    shortStationGroups: buildShortStationGroups(stations),
    elevation: hasElevation ? { gainM: Math.round(gainM), lossM: Math.round(lossM) } : null,
    geometry,
  };
}
