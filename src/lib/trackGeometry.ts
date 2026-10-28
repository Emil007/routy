import { db } from "./db";
import { type LatLng, haversineMeters, closestPointOnPath, pathLengthMeters, reversePoints } from "./geo";
import {
  getSegment,
  canonicalSegmentId,
  isCanonicalSegment,
  updateSegmentGeometry,
  applyGpsHopDurationIfMissing,
  type SegmentRow,
} from "./segments";
import { listNodes } from "./nodes";

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

export type SuggestionResolution = "pending" | "accepted" | "discarded";

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
  /** pending = open; accepted/discarded = resolved for this walk+segment. */
  resolution: SuggestionResolution;
}

const OUTLIER_THRESHOLD_M = 50;
const NODE_MATCH_MAX_M = 80;
const STANDSTILL_MIN_SEC = 60;
const STANDSTILL_RADIUS_M = 20;
const SHORT_REVERSE_MAX_SPUR_M = 50;
const SHORT_REVERSE_RETURN_M = 15;

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
  if (Number.isNaN(t0) || Number.isNaN(t1) || t0 === t1) return null;
  return Math.max(1, Math.round(Math.abs(t1 - t0) / 60000));
}

/** Orient a hop slice to the canonical segment direction (reverse GPS when walked reverse). */
export function orientSliceToCanonical(points: TrackPoint[], walkedReverse: boolean): TrackPoint[] {
  if (!walkedReverse) return points;
  return reversePoints(points) as TrackPoint[];
}

/**
 * Drop interior points of standstill clusters (≥60 s within a small radius).
 * Used only for suggestion geometry — never mutates stored walk tracks.
 */
export function trimStandstills(
  points: TrackPoint[],
  minDurationSec = STANDSTILL_MIN_SEC,
  radiusM = STANDSTILL_RADIUS_M,
): TrackPoint[] {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(true);
  let i = 0;
  while (i < points.length) {
    const start = points[i];
    const t0 = start.time ? Date.parse(start.time) : NaN;
    if (Number.isNaN(t0)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < points.length) {
      if (haversineMeters(start, points[j]) > radiusM) break;
      j++;
    }
    if (j - i >= 3) {
      const tEnd = points[j - 1].time ? Date.parse(points[j - 1].time!) : NaN;
      if (!Number.isNaN(tEnd) && (tEnd - t0) / 1000 >= minDurationSec) {
        for (let k = i + 1; k < j - 1; k++) keep[k] = false;
      }
    }
    i = j > i + 1 ? j - 1 : i + 1;
  }
  return points.filter((_, idx) => keep[idx]);
}

/**
 * Remove short out-and-back spikes (brief reverses / GPS noise).
 * Used only for suggestion geometry.
 */
export function trimShortReverses(
  points: TrackPoint[],
  maxSpurM = SHORT_REVERSE_MAX_SPUR_M,
  returnWithinM = SHORT_REVERSE_RETURN_M,
): TrackPoint[] {
  if (points.length < 4) return points;
  const out = [...points];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      let spurLen = 0;
      for (let j = i + 1; j < out.length; j++) {
        spurLen += haversineMeters(out[j - 1], out[j]);
        if (spurLen > maxSpurM * 2) break;
        if (haversineMeters(out[j], out[i - 1]) <= returnWithinM && spurLen <= maxSpurM * 2) {
          out.splice(i, j - i);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return out;
}

/** Auto-trim standstills and short reverses for suggestion slices only. */
export function trimSuggestionTrack(points: TrackPoint[]): TrackPoint[] {
  if (points.length < 3) return points;
  const trimmed = trimShortReverses(trimStandstills(points));
  return trimmed.length >= 2 ? trimmed : points;
}

type DismissalRow = { resolution: string };

function getDismissal(walkId: number, segmentId: number): DismissalRow | null {
  const row = db
    .prepare("SELECT resolution FROM track_geometry_dismissals WHERE walk_id = ? AND segment_id = ?")
    .get(walkId, segmentId) as DismissalRow | undefined;
  return row ?? null;
}

function writeDismissal(walkId: number, segmentId: number, resolution: "accepted" | "discarded"): void {
  db.prepare(
    `INSERT INTO track_geometry_dismissals (walk_id, segment_id, resolution) VALUES (?, ?, ?)
     ON CONFLICT(walk_id, segment_id) DO UPDATE SET resolution = excluded.resolution, dismissed_at = datetime('now')`,
  ).run(walkId, segmentId, resolution);
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

// ---------------------------------------------------------------------------
// Persistente Analyse (0.57): Die Segment-Aufteilung wird EINMAL beim Einspeisen
// gerechnet und in walk_geometry_analysis gespeichert. Vorher wurde bei jedem
// Seitenaufruf der Track-Geometry-Adminseite über alle Walks hinweg neu analysiert
// (O(n²)-Hops + priorRecordings über alle Walks je Segment) — das hängte die Seite.
// Statusmodell: pending (noch nicht analysiert) → done → trashed (Papierkorb).
// Bei Fehlschlag bleibt pending und attempts steigt; der Startup-/Einspeisungs-Hook
// versucht es später erneut.
// ---------------------------------------------------------------------------

type WalkAnalysisStatus = "pending" | "done" | "trashed";

function analysisRow(walkId: number): {
  status: WalkAnalysisStatus;
  attempts: number;
  suggestions_json: string | null;
} | null {
  return (db
    .prepare("SELECT status, attempts, suggestions_json FROM walk_geometry_analysis WHERE walk_id = ?")
    .get(walkId) as { status: WalkAnalysisStatus; attempts: number; suggestions_json: string | null } | undefined) ?? null;
}

/** Nach dem Einspeisen (complete/free-roam) die Walk-Analyse anlegen/aktualisieren. */
export function enqueueWalkGeometryAnalysis(walkId: number): void {
  db.prepare(
    `INSERT INTO walk_geometry_analysis (walk_id, status, attempts) VALUES (?, 'pending', 0)
     ON CONFLICT(walk_id) DO UPDATE SET status = 'pending', attempts = 0, trashed_at = NULL`,
  ).run(walkId);
}

/** Alle Walks mit erreichter Analyse berechnen (einmalig je Walk). Idempotent. */
export function runPendingGeometryAnalysis(limit = 200): { analyzed: number; failed: number } {
  const pending = db
    .prepare(
      `SELECT w.id
       FROM walk_log w
       LEFT JOIN walk_geometry_analysis a ON a.walk_id = w.id
       WHERE a.walk_id IS NULL OR a.status = 'pending'
       ORDER BY w.accepted_at ASC
       LIMIT ?`,
    )
    .all(limit) as { id: number }[];

  let analyzed = 0;
  let failed = 0;
  for (const { id } of pending) {
    const res = analyzeWalkGeometry(id);
    if (res) analyzed++;
    else failed++;
  }
  return { analyzed, failed };
}

/**
 * Berechnet die Vorschläge EINES Walks und legt sie dauerhaft ab.
 * Gibt die Suggestions zurück oder null bei Fehlschlag (bleibt pending, Retry am Start).
 */
export function analyzeWalkGeometry(walkId: number): SegmentTrackSuggestion[] | null {
  try {
    const suggestions = computeWalkGeoSuggestions(walkId);
    db.prepare(
      `INSERT INTO walk_geometry_analysis (walk_id, status, attempts, suggestions_json, analyzed_at)
       VALUES (?, 'done', 0, ?, datetime('now'))
       ON CONFLICT(walk_id) DO UPDATE SET status = 'done', suggestions_json = excluded.suggestions_json,
         analyzed_at = excluded.analyzed_at`,
    ).run(walkId, JSON.stringify(suggestions));
    return suggestions;
  } catch (err) {
    console.error(`walk geometry analysis failed (walk ${walkId}):`, err);
    db.prepare(
      `INSERT INTO walk_geometry_analysis (walk_id, status, attempts) VALUES (?, 'pending', 1)
       ON CONFLICT(walk_id) DO UPDATE SET attempts = attempts + 1`,
    ).run(walkId);
    return null;
  }
}

/** Sidecar: falls noch keine Zeile existiert (Altdaten), einmalige Analyse nachholen. */
export function ensureWalkGeometryAnalysis(walkId: number): void {
  if (analysisRow(walkId) == null) enqueueWalkGeometryAnalysis(walkId);
}

/** Enum-Status einer Analyse für die API/UI (oder undefined bei fehlendem Eintrag). */
export function analysisStatusFor(walkId: number): WalkAnalysisStatus | "unanalyzed" {
  const a = analysisRow(walkId);
  if (!a) return "unanalyzed";
  return a.status;
}

function computeWalkGeoSuggestions(walkId: number): SegmentTrackSuggestion[] {
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
    // Beide Richtungen beachten: forward+reverse sind EIN physischer Weg (§6.3).
    if (seenCanonical.has(canonId)) continue;
    seenCanonical.add(canonId);

    const walkedReverse = !isCanonicalSegment(segment);
    const oriented = orientSliceToCanonical(points as TrackPoint[], walkedReverse);
    const trimmed = trimSuggestionTrack(oriented);
    if (trimmed.length < 2) continue;

    const officialSeg = getSegment(canonId) ?? segment;
    const official = officialSeg.geometry;
    // Für die Distanz gegen die ERSTE Aufnahme reicht die bisherige Aufnahme aus
    // dieser Walk-Analyse (only that walk) — willkürlich, aber konsistent für die
    // Admin-Entscheidung. (Die alte „alle Walks“-Basis war der O(n²)-Hänger.)
    const firstRecordingGeometry = null;
    const { isOutlier, avgOfficial } = isOutlierSuggestion(trimmed, official, null);

    const dismissal = getDismissal(walkId, canonId);
    let resolution: SuggestionResolution = "pending";
    if (dismissal?.resolution === "accepted") resolution = "accepted";
    else if (dismissal) resolution = "discarded";

    suggestions.push({
      walkId,
      segmentId: canonId,
      canonicalSegmentId: canonId,
      segmentName: officialSeg.name,
      points: trimmed,
      firstRecordingGeometry,
      recordedAt: walkRow.accepted_at,
      isOutlier,
      avgDistanceToOfficialM: Math.round(avgOfficial),
      avgDistanceToFirstRecordingM: null,
      resolution,
    });
  }

  return suggestions.sort((a, b) => a.segmentId - b.segmentId);
}

/** Aus der persistenten Analyse lesen (keine Neuberechnung mehr). */
export function getWalkTrackSuggestions(walkId: number): SegmentTrackSuggestion[] {
  const row = analysisRow(walkId);
  if (!row || row.status === "pending" || row.status === "trashed" || !row.suggestions_json) return [];
  try {
    const parsed = JSON.parse(row.suggestions_json) as SegmentTrackSuggestion[];
    // Resolution immer live aus der Dismissals-Tabelle spiegeln.
    return parsed.map((s) => {
      const dismissal = getDismissal(walkId, s.canonicalSegmentId);
      let resolution: SuggestionResolution = "pending";
      if (dismissal?.resolution === "accepted") resolution = "accepted";
      else if (dismissal) resolution = "discarded";
      return { ...s, resolution };
    });
  } catch {
    return [];
  }
}

/**
 * Liste aller Walk-Aufnahmen (auch ohne empfangene Track-Analyse), für die Papierkorb-/Review-Ansicht.
 * Enthält status/pending/done und Zahl offener + gelöster Vorschläge.
 */
export interface WalkAnalysisRow {
  walk: WalkWithTrackRow;
  analysisStatus: WalkAnalysisStatus | "unanalyzed";
  pendingCount: number;
  resolvedCount: number;
}

export function listWalkAnalyses(): WalkAnalysisRow[] {
  const walks = listWalksWithTrack();
  const out: WalkAnalysisRow[] = [];
  for (const walk of walks) {
    const a = analysisRow(walk.id);
    const status: WalkAnalysisStatus | "unanalyzed" =
      !a ? "unanalyzed" : a.status === "trashed" ? "trashed" : a.status === "done" ? "done" : "pending";
    const suggestions = status === "done" ? walkSuggestionsFromJson(a?.suggestions_json) : [];
    const pendingCount = suggestions.filter((s) => s.resolution === "pending" && !s.isOutlier).length;
    const resolvedCount = suggestions.filter((s) => s.resolution !== "pending").length;
    out.push({ walk, analysisStatus: status, pendingCount, resolvedCount });
  }
  return out;
}

function walkSuggestionsFromJson(json: string | null | undefined): SegmentTrackSuggestion[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as SegmentTrackSuggestion[];
  } catch {
    return [];
  }
}

/** Papierkorb: Aufnahme + Analyse inaktivieren (review abgeschlossen/zurückgelegt). */
export function trashWalkAnalysis(walkId: number): { ok: true } | { error: string } {
  const row = analysisRow(walkId);
  if (!row) return { error: "not_found" };
  const trashedAt = new Date().toISOString();
  db.prepare(
    "UPDATE walk_geometry_analysis SET status = 'trashed', trashed_at = ? WHERE walk_id = ?",
  ).run(trashedAt, walkId);
  return { ok: true };
}

/** Manuelles Löschen: Aufnahme komplett entfernen (ohne dass alle Segmente geprüft wurden). */
export function deleteWalkAnalysis(walkId: number): { ok: true } | { error: string } {
  const walk = db.prepare("SELECT id FROM walk_log WHERE id = ?").get(walkId) as { id: number } | undefined;
  if (!walk) return { error: "not_found" };
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM walk_geometry_analysis WHERE walk_id = ?").run(walkId);
    db.prepare("DELETE FROM track_geometry_dismissals WHERE walk_id = ?").run(walkId);
    db.prepare("DELETE FROM walk_track WHERE walk_id = ?").run(walkId);
    db.prepare("UPDATE walk_log SET track_json = NULL WHERE id = ?").run(walkId);
  });
  tx();
  return { ok: true };
}

/** Papierkorb aufräumen: trashed-Aufnahmen nach 30d + nochmal 30d Papierkorb löschen. */
export function purgeTrashedWalkAnalyses(): number {
  const info = db
    .prepare(
      `DELETE FROM walk_geometry_analysis
       WHERE status = 'trashed' AND trashed_at IS NOT NULL
         AND trashed_at < datetime('now', '-30 days')`,
    )
    .run();
  // Auch die eigentlichen Aufnahmen sind dann weg.
  let removedRecs = 0;
  if (info.changes > 0) {
    const walks = db
      .prepare(
        `SELECT w.id FROM walk_log w
         INNER JOIN walk_geometry_analysis a ON a.walk_id = w.id
         WHERE a.status = 'trashed' AND a.trashed_at IS NOT NULL
           AND a.trashed_at < datetime('now', '-30 days')`,
      )
      .all() as { id: number }[];
    for (const { id } of walks) {
      db.prepare("DELETE FROM walk_track WHERE walk_id = ?").run(id);
      db.prepare("DELETE FROM track_geometry_dismissals WHERE walk_id = ?").run(id);
      db.prepare("UPDATE walk_log SET track_json = NULL WHERE id = ?").run(id);
      db.prepare("DELETE FROM walk_geometry_analysis WHERE walk_id = ?").run(id);
    }
    removedRecs = walks.length;
  }
  return info.changes + removedRecs;
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

/** Pending = neueste nicht-outlier, nicht-aufgelöster Vorschlag pro kanonischem Segment,
 *  jetzt aus der PERSISTENTEN Analyse gelesen (keine Neuberechnung, 0.57). */
export function listPendingSegmentSuggestions(): SegmentTrackSuggestion[] {
  const byCanonical = new Map<number, SegmentTrackSuggestion>();
  for (const row of listWalkAnalyses()) {
    if (row.analysisStatus !== "done") continue;
    for (const s of getWalkTrackSuggestions(row.walk.id)) {
      if (s.isOutlier || s.resolution !== "pending") continue;
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
  if (suggestion.resolution !== "pending") return { error: "already_resolved" };
  if (suggestion.isOutlier) return { error: "outlier" };
  if (suggestion.points.length < 2) return { error: "too_few_points" };

  const walkRow = db.prepare("SELECT track_json FROM walk_log WHERE id = ?").get(walkId) as
    | { track_json: string | null }
    | undefined;
  const fullTrack = loadWalkTrack(walkId, walkRow?.track_json ?? null) as TrackPoint[];
  const nodeChainRow = db.prepare("SELECT node_chain, segment_ids FROM walk_log WHERE id = ?").get(walkId) as
    | { node_chain: string; segment_ids: string }
    | undefined;
  let gpsPoints: TrackPoint[] = suggestion.points as TrackPoint[];
  if (nodeChainRow) {
    const nodeChain = JSON.parse(nodeChainRow.node_chain) as number[];
    const segmentIds = JSON.parse(nodeChainRow.segment_ids) as number[];
    const slices = splitTrackByRoute(fullTrack, nodeChain, segmentIds);
    let slice: LatLng[] | undefined = slices.get(segmentId);
    let walkedReverse = false;
    if (!slice) {
      for (const [hopId, pts] of slices) {
        const hop = getSegment(hopId);
        if (!hop || canonicalSegmentId(hop) !== segmentId) continue;
        slice = pts;
        walkedReverse = !isCanonicalSegment(hop);
        break;
      }
    } else {
      const hop = getSegment(segmentId);
      walkedReverse = hop ? !isCanonicalSegment(hop) : false;
    }
    if (slice && slice.length >= 2) {
      gpsPoints = trimSuggestionTrack(
        orientSliceToCanonical(slice as TrackPoint[], walkedReverse),
      );
    }
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

  // Resolve this walk+segment so the chip leaves the pending set (same as discard).
  writeDismissal(walkId, segmentId, "accepted");

  const segment = getSegment(segmentId);
  if (!segment) return { error: "not_found" };
  return { ok: true, segment };
}

export function discardTrackSuggestion(walkId: number, segmentId: number): { ok: true } | { error: string } {
  const suggestions = getWalkTrackSuggestions(walkId);
  const suggestion = suggestions.find((s) => s.segmentId === segmentId);
  if (!suggestion) return { error: "not_found" };
  if (suggestion.resolution !== "pending") return { error: "already_resolved" };
  writeDismissal(walkId, segmentId, "discarded");
  return { ok: true };
}

/**
 * Admin hygiene: delete GPS recording for a walk without wiping walk_log stats.
 * Clears walk_track and walk_log.track_json only.
 */
export function removeWalkRecording(walkId: number): { ok: true } | { error: string } {
  const walk = db.prepare("SELECT id FROM walk_log WHERE id = ?").get(walkId) as { id: number } | undefined;
  if (!walk) return { error: "not_found" };
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM walk_track WHERE walk_id = ?").run(walkId);
    db.prepare("UPDATE walk_log SET track_json = NULL WHERE id = ?").run(walkId);
    db.prepare("DELETE FROM track_geometry_dismissals WHERE walk_id = ?").run(walkId);
  });
  tx();
  return { ok: true };
}

/** When a walk uploads GPS with timestamps, persist per-hop durations on segments that lack them. */
export function persistHopTimingsFromWalk(
  walkId: number,
  opts: { walkUserId?: number | null; walkerIsAdmin?: boolean } = {},
): void {
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
    applyGpsHopDurationIfMissing(segId, duration, opts);
  }
}

export interface TimedWalkSpeedTips {
  timedCount: number;
  avgAllKmh: number | null;
  avgLast3Kmh: number | null;
}

/**
 * Average walking speed from timed GPS tracks (first→last timestamp + walk length).
 * Uses GPS elapsed time, not planned route duration.
 */
export function timedWalkSpeedTips(userId: number): TimedWalkSpeedTips {
  const rows = db
    .prepare(
      `SELECT w.length_m, w.accepted_at, w.track_json, wt.points_json AS wt_points
       FROM walk_log w
       LEFT JOIN walk_track wt ON wt.walk_id = w.id
       WHERE w.user_id = ? AND (w.track_json IS NOT NULL OR wt.walk_id IS NOT NULL)
       ORDER BY w.accepted_at DESC`,
    )
    .all(userId) as {
    length_m: number;
    accepted_at: string;
    track_json: string | null;
    wt_points: string | null;
  }[];

  const speeds: number[] = [];
  for (const r of rows) {
    const track = r.wt_points ? parseTrack(r.wt_points) : parseTrack(r.track_json);
    if (track.length < 2 || r.length_m <= 0) continue;
    const t0 = track[0].time ? Date.parse(track[0].time) : NaN;
    const t1 = track[track.length - 1].time ? Date.parse(track[track.length - 1].time!) : NaN;
    if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) continue;
    const hours = (t1 - t0) / 3_600_000;
    if (hours <= 0) continue;
    const kmh = r.length_m / 1000 / hours;
    if (kmh > 0 && kmh < 20) speeds.push(kmh);
  }

  if (speeds.length === 0) {
    return { timedCount: 0, avgAllKmh: null, avgLast3Kmh: null };
  }

  const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  return {
    timedCount: speeds.length,
    avgAllKmh: avg(speeds),
    avgLast3Kmh: speeds.length > 3 ? avg(speeds.slice(0, 3)) : null,
  };
}

/** Exposed for tests that need path length on trimmed slices. */
export function suggestionTrackLengthM(points: LatLng[]): number {
  return pathLengthMeters(points);
}
