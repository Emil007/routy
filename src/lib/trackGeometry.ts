import { db } from "./db";
import { type LatLng, haversineMeters, closestPointOnPath } from "./geo";
import {
  getSegment,
  canonicalSegmentId,
  isCanonicalSegment,
  updateSegmentGeometry,
  applyGpsHopDurationIfMissing,
  type SegmentRow,
} from "./segments";
import { listNodes } from "./nodes";
import { getSettings, effectiveWalkSpeedKmh } from "./settings";

export interface TrackPoint extends LatLng {
  time?: string;
  accuracy?: number;
  speed?: number;
  bearing?: number;
}

export interface WalkWithTrackRow {
  id: number;
  userId: number;
  userDisplayName: string;
  nickname: string | null;
  acceptedAt: string;
  lengthM: number;
  segmentIds: number[];
  nodeChain: number[];
  pointCount: number;
}

export interface SegmentTrackSuggestion {
  walkId: number;
  segmentId: number;
  canonicalSegmentId: number;
  segmentName: string | null;
  points: LatLng[];
  firstRecordingGeometry: LatLng[] | null;
  recordedAt: string;
  isOutlier: boolean;
  avgDistanceToOfficialM: number;
  avgDistanceToFirstRecordingM: number | null;
}

const OUTLIER_THRESHOLD_M = 50;
const NODE_MATCH_MAX_M = 80;

function parseTrack(raw: string | null): TrackPoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TrackPoint[];
    return Array.isArray(parsed)
      ? parsed.filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
      : [];
  } catch {
    return [];
  }
}

/** Duration in minutes from GPS timestamps on a track slice, when both ends have valid times. */
export function durationMinFromTrackPoints(points: TrackPoint[]): number | null {
  if (points.length < 2) return null;
  const t0Raw = points[0]?.time;
  const t1Raw = points[points.length - 1]?.time;
  const t0 = t0Raw ? Date.parse(t0Raw) : NaN;
  const t1 = t1Raw ? Date.parse(t1Raw) : NaN;
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) return null;
  return Math.max(1, Math.round((t1 - t0) / 60000));
}

function isDismissed(walkId: number, segmentId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM track_geometry_dismissals WHERE walk_id = ? AND segment_id = ?")
    .get(walkId, segmentId);
  return row != null;
}

function loadWalkTrack(walkId: number, trackJson: string | null): TrackPoint[] {
  const row = db.prepare("SELECT points_json FROM walk_track WHERE walk_id = ?").get(walkId) as
    | { points_json: string }
    | undefined;
  if (row) return parseTrack(row.points_json);
  return parseTrack(trackJson);
}

/** Average distance from each sample on `sampled` to polyline `reference`. */
export function avgDistanceToPath(sampled: LatLng[], reference: LatLng[]): number {
  if (sampled.length === 0 || reference.length < 2) return Infinity;
  let total = 0;
  for (const p of sampled) {
    const closest = closestPointOnPath(reference, p);
    total += closest?.distanceM ?? Infinity;
  }
  return total / sampled.length;
}

/** Find monotonically increasing track indices nearest each node in `nodeChain`. */
export function nodeIndicesOnTrack(
  track: LatLng[],
  nodeChain: number[],
  nodeCoords: Map<number, LatLng>,
): number[] {
  const indices: number[] = [];
  let searchFrom = 0;
  for (const nodeId of nodeChain) {
    const coord = nodeCoords.get(nodeId);
    if (!coord || track.length === 0) {
      indices.push(searchFrom);
      continue;
    }
    let bestIdx = searchFrom;
    let bestDist = Infinity;
    for (let i = searchFrom; i < track.length; i++) {
      const d = haversineMeters(track[i], coord);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist > NODE_MATCH_MAX_M) {
      indices.push(searchFrom);
    } else {
      indices.push(bestIdx);
      searchFrom = bestIdx;
    }
  }
  return indices;
}

/** Split a walk track into one slice per hop (segment) along the node chain. */
export function splitTrackByRoute(
  track: LatLng[],
  nodeChain: number[],
  segmentIds: number[],
): Map<number, LatLng[]> {
  const nodeCoords = new Map(listNodes().map((n) => [n.id, { lat: n.lat, lng: n.lng }]));
  const nodeIdx = nodeIndicesOnTrack(track, nodeChain, nodeCoords);
  const bySegment = new Map<number, LatLng[]>();

  for (let hop = 0; hop < segmentIds.length; hop++) {
    const startIdx = nodeIdx[hop] ?? 0;
    const endIdx = nodeIdx[hop + 1] ?? track.length - 1;
    if (endIdx <= startIdx) continue;
    const slice = track.slice(startIdx, endIdx + 1);
    if (slice.length >= 2) bySegment.set(segmentIds[hop], slice);
  }
  return bySegment;
}

function isOutlierSuggestion(
  points: LatLng[],
  official: LatLng[],
  firstRecording: LatLng[] | null,
): { isOutlier: boolean; avgOfficial: number; avgFirst: number | null } {
  const avgOfficial = avgDistanceToPath(points, official);
  if (avgOfficial <= OUTLIER_THRESHOLD_M) {
    return { isOutlier: false, avgOfficial, avgFirst: null };
  }
  if (!firstRecording || firstRecording.length < 2) {
    return { isOutlier: avgOfficial > OUTLIER_THRESHOLD_M, avgOfficial, avgFirst: null };
  }
  const avgFirst = avgDistanceToPath(points, firstRecording);
  const isOutlier = avgOfficial > OUTLIER_THRESHOLD_M && avgFirst > OUTLIER_THRESHOLD_M;
  return { isOutlier, avgOfficial, avgFirst };
}

/** Backup current canonical geometry before replacing it. */
export function backupSegmentGeometry(segmentId: number, reason: string): void {
  const segment = getSegment(segmentId);
  if (!segment || !isCanonicalSegment(segment)) return;
  const ele = segment.elevation;
  db.prepare(
    `INSERT INTO segment_geometry_history
      (segment_id, geometry_json, length_m, ele_gain_m, ele_loss_m, duration_min, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    segment.id,
    JSON.stringify(segment.geometry),
    segment.lengthM,
    ele?.gainM ?? null,
    ele?.lossM ?? null,
    segment.durationMin,
    reason,
  );
}

export function listWalksWithTrack(): WalkWithTrackRow[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.user_id, w.nickname, w.accepted_at, w.length_m, w.segment_ids, w.node_chain, w.track_json,
              u.display_name AS user_display_name,
              wt.points_json AS wt_points
       FROM walk_log w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN walk_track wt ON wt.walk_id = w.id
       WHERE w.track_json IS NOT NULL OR wt.walk_id IS NOT NULL
       ORDER BY w.accepted_at DESC`,
    )
    .all() as {
    id: number;
    user_id: number;
    nickname: string | null;
    accepted_at: string;
    length_m: number;
    segment_ids: string;
    node_chain: string;
    track_json: string | null;
    user_display_name: string;
    wt_points: string | null;
  }[];

  return rows.map((r) => {
    const track = r.wt_points ? parseTrack(r.wt_points) : parseTrack(r.track_json);
    return {
      id: r.id,
      userId: r.user_id,
      userDisplayName: r.user_display_name,
      nickname: r.nickname,
      acceptedAt: r.accepted_at,
      lengthM: r.length_m,
      segmentIds: JSON.parse(r.segment_ids) as number[],
      nodeChain: JSON.parse(r.node_chain) as number[],
      pointCount: track.length,
    };
  });
}

/** All non-outlier track slices for a canonical segment (oldest first). */
function priorRecordingsForSegment(canonicalId: number): LatLng[][] {
  const canonical = getSegment(canonicalId);
  if (!canonical) return [];
  const official = canonical.geometry;
  const recordings: LatLng[][] = [];

  for (const walk of listWalksWithTrack()) {
    const track = loadWalkTrack(walk.id, null);
    if (track.length < 2) continue;
    const slices = splitTrackByRoute(track, walk.nodeChain, walk.segmentIds);
    for (const [segId, points] of slices) {
      if (canonicalSegmentId(getSegment(segId) ?? { id: segId, reverseOf: null }) !== canonicalId) continue;
      const { isOutlier } = isOutlierSuggestion(points, official, recordings[0] ?? null);
      if (!isOutlier) recordings.push(points);
    }
  }
  return recordings;
}

export function getWalkTrackSuggestions(walkId: number): SegmentTrackSuggestion[] {
  const walkRow = db
    .prepare(
      `SELECT w.id, w.accepted_at, w.segment_ids, w.node_chain, w.track_json
       FROM walk_log w WHERE w.id = ?`,
    )
    .get(walkId) as
    | {
        id: number;
        accepted_at: string;
        segment_ids: string;
        node_chain: string;
        track_json: string | null;
      }
    | undefined;
  if (!walkRow) return [];

  const track = loadWalkTrack(walkId, walkRow.track_json);
  if (track.length < 2) return [];

  const nodeChain = JSON.parse(walkRow.node_chain) as number[];
  const segmentIds = JSON.parse(walkRow.segment_ids) as number[];
  const slices = splitTrackByRoute(track, nodeChain, segmentIds);
  const suggestions: SegmentTrackSuggestion[] = [];

  const seenCanonical = new Set<number>();
  for (const [segmentId, points] of slices) {
    const segment = getSegment(segmentId);
    if (!segment) continue;
    const canonId = canonicalSegmentId(segment);
    if (!isCanonicalSegment(segment)) continue;
    if (seenCanonical.has(canonId)) continue;
    seenCanonical.add(canonId);

    const official = segment.geometry;
    const prior = priorRecordingsForSegment(canonId);
    const firstRecording = prior[0] ?? null;
    const { isOutlier, avgOfficial, avgFirst } = isOutlierSuggestion(points, official, firstRecording);
    if (isDismissed(walkId, canonId)) continue;

    suggestions.push({
      walkId,
      segmentId: canonId,
      canonicalSegmentId: canonId,
      segmentName: segment.name,
      points,
      firstRecordingGeometry: firstRecording,
      recordedAt: walkRow.accepted_at,
      isOutlier,
      avgDistanceToOfficialM: Math.round(avgOfficial),
      avgDistanceToFirstRecordingM: avgFirst !== null ? Math.round(avgFirst) : null,
    });
  }

  return suggestions.sort((a, b) => a.segmentId - b.segmentId);
}

/** Pending = latest non-outlier suggestion per canonical segment across all walks. */
export function listPendingSegmentSuggestions(): SegmentTrackSuggestion[] {
  const byCanonical = new Map<number, SegmentTrackSuggestion>();
  for (const walk of listWalksWithTrack()) {
    for (const s of getWalkTrackSuggestions(walk.id)) {
      if (s.isOutlier) continue;
      const existing = byCanonical.get(s.canonicalSegmentId);
      if (!existing || s.recordedAt > existing.recordedAt) {
        byCanonical.set(s.canonicalSegmentId, s);
      }
    }
  }
  return [...byCanonical.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function acceptTrackSuggestion(
  walkId: number,
  segmentId: number,
  walkSpeedKmh: number,
): { ok: true; segment: SegmentRow } | { error: string } {
  const suggestions = getWalkTrackSuggestions(walkId);
  const suggestion = suggestions.find((s) => s.segmentId === segmentId);
  if (!suggestion) return { error: "not_found" };
  if (suggestion.isOutlier) return { error: "outlier" };
  if (suggestion.points.length < 2) return { error: "too_few_points" };

  const walkRow = db.prepare("SELECT track_json FROM walk_log WHERE id = ?").get(walkId) as
    | { track_json: string | null }
    | undefined;
  const fullTrack = loadWalkTrack(walkId, walkRow?.track_json ?? null) as TrackPoint[];
  const nodeChainRow = db.prepare("SELECT node_chain, segment_ids FROM walk_log WHERE id = ?").get(walkId) as
    | { node_chain: string; segment_ids: string }
    | undefined;
  let gpsPoints: TrackPoint[] = suggestion.points;
  if (nodeChainRow) {
    const nodeChain = JSON.parse(nodeChainRow.node_chain) as number[];
    const segmentIds = JSON.parse(nodeChainRow.segment_ids) as number[];
    const slices = splitTrackByRoute(fullTrack, nodeChain, segmentIds);
    const slice = slices.get(segmentId);
    if (slice && slice.length >= 2) gpsPoints = slice as TrackPoint[];
  }

  const gpsDuration = durationMinFromTrackPoints(gpsPoints);

  backupSegmentGeometry(segmentId, `walk_track:${walkId}`);
  const result = updateSegmentGeometry(segmentId, gpsPoints, walkSpeedKmh, gpsDuration ?? undefined);
  if ("error" in result) return { error: result.error };
  if (gpsDuration != null) {
    db.prepare("UPDATE segments SET duration_from_gps = 1 WHERE id = ? OR id = ?").run(
      segmentId,
      getSegment(segmentId)?.reverseOf ?? -1,
    );
  }

  const segment = getSegment(segmentId);
  if (!segment) return { error: "not_found" };
  return { ok: true, segment };
}

export function discardTrackSuggestion(walkId: number, segmentId: number): { ok: true } | { error: string } {
  const suggestions = getWalkTrackSuggestions(walkId);
  if (!suggestions.some((s) => s.segmentId === segmentId)) return { error: "not_found" };
  db.prepare(
    `INSERT INTO track_geometry_dismissals (walk_id, segment_id) VALUES (?, ?)
     ON CONFLICT(walk_id, segment_id) DO NOTHING`,
  ).run(walkId, segmentId);
  return { ok: true };
}

/** When a walk uploads GPS with timestamps, persist per-hop durations on segments that lack them. */
export function persistHopTimingsFromWalk(walkId: number, walkSpeedKmh: number): void {
  const walkRow = db
    .prepare("SELECT node_chain, segment_ids, track_json FROM walk_log WHERE id = ?")
    .get(walkId) as { node_chain: string; segment_ids: string; track_json: string | null } | undefined;
  if (!walkRow) return;

  const track = loadWalkTrack(walkId, walkRow.track_json) as TrackPoint[];
  if (track.length < 2) return;

  const nodeChain = JSON.parse(walkRow.node_chain) as number[];
  const segmentIds = JSON.parse(walkRow.segment_ids) as number[];
  const slices = splitTrackByRoute(track, nodeChain, segmentIds);

  for (const [segId, points] of slices) {
    const duration = durationMinFromTrackPoints(points as TrackPoint[]);
    if (duration == null) continue;
    applyGpsHopDurationIfMissing(segId, duration);
  }
}
