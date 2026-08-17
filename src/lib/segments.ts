import { db } from "./db";
import { type LatLng, reversePoints, pathLengthMeters, estimateMinutes, elevationStats, closestPointOnPath } from "./geo";
import type { ElevationStats } from "./geo";
import { createNode, getNode, updateNodePosition, type NodeRow } from "./nodes";

export interface SegmentRow {
  id: number;
  startNodeId: number;
  endNodeId: number;
  geometry: LatLng[];
  lengthM: number;
  durationMin: number;
  elevation: ElevationStats | null;
  source: "gpx" | "drawn";
  reverseOf: number | null;
  submittedBy: number | null;
  createdAt: string;
}

interface SegmentDbRow {
  id: number;
  start_node_id: number;
  end_node_id: number;
  geometry: string;
  length_m: number;
  duration_min: number;
  ele_gain_m: number | null;
  ele_loss_m: number | null;
  ele_min_m: number | null;
  ele_max_m: number | null;
  source: string;
  reverse_of: number | null;
  submitted_by: number | null;
  created_at: string;
}

function mapSegment(row: SegmentDbRow): SegmentRow {
  return {
    id: row.id,
    startNodeId: row.start_node_id,
    endNodeId: row.end_node_id,
    geometry: JSON.parse(row.geometry) as LatLng[],
    lengthM: row.length_m,
    durationMin: row.duration_min,
    elevation:
      row.ele_gain_m !== null
        ? { gainM: row.ele_gain_m, lossM: row.ele_loss_m ?? 0, minM: row.ele_min_m ?? 0, maxM: row.ele_max_m ?? 0 }
        : null,
    source: row.source === "drawn" ? "drawn" : "gpx",
    reverseOf: row.reverse_of,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
  };
}

export function listSegments(): SegmentRow[] {
  const rows = db.prepare("SELECT * FROM segments ORDER BY id").all() as SegmentDbRow[];
  return rows.map(mapSegment);
}

export function getSegment(id: number): SegmentRow | null {
  const row = db.prepare("SELECT * FROM segments WHERE id = ?").get(id) as SegmentDbRow | undefined;
  return row ? mapSegment(row) : null;
}

/**
 * Each physical path is stored as two rows (forward + auto-generated reverse)
 * whose reverse_of columns point at each other, so neither is ever null.
 * The forward row is always inserted first and therefore has the lower id —
 * that's the canonical, one-row-per-physical-path representative to use
 * whenever a UI should show each path once (not once per direction).
 */
export function isCanonicalSegment(s: Pick<SegmentRow, "id" | "reverseOf">): boolean {
  return s.reverseOf === null || s.id < s.reverseOf;
}

export interface NewSegmentInput {
  startNodeId: number;
  endNodeId: number;
  points: LatLng[];
  lengthM: number;
  durationMin: number;
  elevation: ElevationStats | null;
  source: "gpx" | "drawn";
  submittedBy: number;
}

/** Inserts a segment and its automatic reverse-direction counterpart in one transaction. */
export function createSegmentWithReverse(input: NewSegmentInput): { forwardId: number; reverseId: number } {
  const tx = db.transaction(() => {
    const forward = db
      .prepare(
        `INSERT INTO segments
         (start_node_id, end_node_id, geometry, length_m, duration_min, ele_gain_m, ele_loss_m, ele_min_m, ele_max_m, source, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.startNodeId,
        input.endNodeId,
        JSON.stringify(input.points),
        input.lengthM,
        input.durationMin,
        input.elevation?.gainM ?? null,
        input.elevation?.lossM ?? null,
        input.elevation?.minM ?? null,
        input.elevation?.maxM ?? null,
        input.source,
        input.submittedBy,
      );
    const forwardId = Number(forward.lastInsertRowid);
    db.prepare("INSERT INTO segment_usage (segment_id, usage_count) VALUES (?, 0)").run(forwardId);

    const reversePts = reversePoints(input.points);
    const reverseElevation: ElevationStats | null = input.elevation
      ? {
          gainM: input.elevation.lossM,
          lossM: input.elevation.gainM,
          minM: input.elevation.minM,
          maxM: input.elevation.maxM,
        }
      : null;

    const reverse = db
      .prepare(
        `INSERT INTO segments
         (start_node_id, end_node_id, geometry, length_m, duration_min, ele_gain_m, ele_loss_m, ele_min_m, ele_max_m, source, reverse_of, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.endNodeId,
        input.startNodeId,
        JSON.stringify(reversePts),
        input.lengthM,
        input.durationMin,
        reverseElevation?.gainM ?? null,
        reverseElevation?.lossM ?? null,
        reverseElevation?.minM ?? null,
        reverseElevation?.maxM ?? null,
        input.source,
        forwardId,
        input.submittedBy,
      );
    const reverseId = Number(reverse.lastInsertRowid);
    db.prepare("INSERT INTO segment_usage (segment_id, usage_count) VALUES (?, 0)").run(reverseId);
    db.prepare("UPDATE segments SET reverse_of = ? WHERE id = ?").run(reverseId, forwardId);

    return { forwardId, reverseId };
  });

  return tx();
}

export function getUsageMap(): Map<number, number> {
  const rows = db.prepare("SELECT segment_id, usage_count FROM segment_usage").all() as {
    segment_id: number;
    usage_count: number;
  }[];
  return new Map(rows.map((r) => [r.segment_id, r.usage_count]));
}

export function getDailyUsageMap(): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT segment_ids FROM walk_log WHERE date(accepted_at) = date('now')`,
    )
    .all() as { segment_ids: string }[];
  const map = new Map<number, number>();
  for (const row of rows) {
    const ids = JSON.parse(row.segment_ids) as number[];
    for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

export function recordWalk(userId: number, nodeChain: number[], segmentIds: number[], lengthM: number, durationMin: number): void {
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO walk_log (user_id, node_chain, segment_ids, length_m, duration_min) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, JSON.stringify(nodeChain), JSON.stringify(segmentIds), lengthM, durationMin);

    const bump = db.prepare(
      "UPDATE segment_usage SET usage_count = usage_count + 1, last_used_at = datetime('now') WHERE segment_id = ?",
    );
    for (const id of segmentIds) bump.run(id);
  });
  tx();
}

/**
 * Deletes a segment. Because the forward/reverse pair reference each other via
 * `reverse_of` (both `ON DELETE CASCADE`), deleting either row automatically
 * deletes its counterpart and both `segment_usage` rows.
 */
export function deleteSegment(id: number): void {
  db.prepare("DELETE FROM segments WHERE id = ?").run(id);
}

function resolveCanonical(id: number): SegmentRow | null {
  const row = getSegment(id);
  if (!row) return null;
  if (isCanonicalSegment(row)) return row;
  return row.reverseOf !== null ? getSegment(row.reverseOf) : null;
}

/** Writes new geometry to a canonical/reverse pair, recomputing length/duration/elevation for both. */
function writeSegmentGeometry(canonical: SegmentRow, reverse: SegmentRow, points: LatLng[], walkSpeedKmh: number): void {
  const lengthM = Math.round(pathLengthMeters(points));
  const durationMin = estimateMinutes(lengthM, walkSpeedKmh);
  const elevation = elevationStats(points);
  const reversePts = reversePoints(points);
  const reverseElevation: ElevationStats | null = elevation
    ? { gainM: elevation.lossM, lossM: elevation.gainM, minM: elevation.minM, maxM: elevation.maxM }
    : null;

  const update = db.prepare(
    `UPDATE segments SET geometry = ?, length_m = ?, duration_min = ?, ele_gain_m = ?, ele_loss_m = ?, ele_min_m = ?, ele_max_m = ? WHERE id = ?`,
  );
  update.run(
    JSON.stringify(points),
    lengthM,
    durationMin,
    elevation?.gainM ?? null,
    elevation?.lossM ?? null,
    elevation?.minM ?? null,
    elevation?.maxM ?? null,
    canonical.id,
  );
  update.run(
    JSON.stringify(reversePts),
    lengthM,
    durationMin,
    reverseElevation?.gainM ?? null,
    reverseElevation?.lossM ?? null,
    reverseElevation?.minM ?? null,
    reverseElevation?.maxM ?? null,
    reverse.id,
  );
}

/**
 * Repositions the interior points of a segment (its two endpoints stay pinned to
 * their nodes) — for correcting the shape of an already-submitted path without
 * changing what it connects.
 */
export function updateSegmentGeometry(
  segmentId: number,
  points: LatLng[],
  walkSpeedKmh: number,
): { ok: true } | { error: "not_found" | "point_count_mismatch" } {
  const canonical = resolveCanonical(segmentId);
  if (!canonical || canonical.reverseOf === null) return { error: "not_found" };
  const reverse = getSegment(canonical.reverseOf);
  if (!reverse) return { error: "not_found" };
  if (points.length !== canonical.geometry.length) return { error: "point_count_mismatch" };

  const fixedPoints = points.map((p, i) =>
    i === 0 || i === points.length - 1 ? canonical.geometry[i] : p,
  );
  const tx = db.transaction(() => writeSegmentGeometry(canonical, reverse, fixedPoints, walkSpeedKmh));
  tx();
  return { ok: true };
}

/**
 * Moves a node and drags along the touching end of every segment connected to
 * it, so the network stays visually consistent (no gap between a moved node
 * and the paths that meet it).
 */
export function moveNode(nodeId: number, point: LatLng, walkSpeedKmh: number): { touchedSegments: number } {
  const touching = listSegments()
    .filter(isCanonicalSegment)
    .filter((s) => s.startNodeId === nodeId || s.endNodeId === nodeId);

  const tx = db.transaction(() => {
    updateNodePosition(nodeId, point);
    for (const s of touching) {
      if (s.reverseOf === null) continue;
      const reverse = getSegment(s.reverseOf);
      if (!reverse) continue;
      const geometry = [...s.geometry];
      if (s.startNodeId === nodeId) geometry[0] = point;
      if (s.endNodeId === nodeId) geometry[geometry.length - 1] = point;
      writeSegmentGeometry(s, reverse, geometry, walkSpeedKmh);
    }
  });
  tx();
  return { touchedSegments: touching.length };
}

/**
 * Splits a segment into two at the point on its path closest to `near` — for
 * introducing a new junction (e.g. a crossing path) into an already-submitted
 * segment. Reuses a nearby existing node instead of creating a duplicate one
 * when `near` already lands within the merge radius of one.
 */
export function splitSegment(
  segmentId: number,
  near: LatLng,
  endpoint: { nodeId: number } | { newName: string | null },
  submittedBy: number,
  walkSpeedKmh: number,
): { newNodeId: number } | { error: "not_found" | "too_far" | "too_close_to_endpoint" | "unknown_node" } {
  const canonical = resolveCanonical(segmentId);
  if (!canonical) return { error: "not_found" };

  const closest = closestPointOnPath(canonical.geometry, near);
  if (!closest) return { error: "not_found" };
  if (closest.distanceM > 100) return { error: "too_far" };

  const geomA = [...canonical.geometry.slice(0, closest.index + 1), closest.point];
  const geomB = [closest.point, ...canonical.geometry.slice(closest.index + 1)];
  const lengthA = pathLengthMeters(geomA);
  const lengthB = pathLengthMeters(geomB);
  if (lengthA < 2 || lengthB < 2) return { error: "too_close_to_endpoint" };

  let midNode: NodeRow;
  if ("nodeId" in endpoint) {
    const node = getNode(endpoint.nodeId);
    if (!node) return { error: "unknown_node" };
    midNode = node;
  } else {
    midNode = createNode(endpoint.newName, closest.point);
  }

  const tx = db.transaction(() => {
    createSegmentWithReverse({
      startNodeId: canonical.startNodeId,
      endNodeId: midNode.id,
      points: geomA,
      lengthM: Math.round(lengthA),
      durationMin: estimateMinutes(lengthA, walkSpeedKmh),
      elevation: elevationStats(geomA),
      source: canonical.source,
      submittedBy,
    });
    createSegmentWithReverse({
      startNodeId: midNode.id,
      endNodeId: canonical.endNodeId,
      points: geomB,
      lengthM: Math.round(lengthB),
      durationMin: estimateMinutes(lengthB, walkSpeedKmh),
      elevation: elevationStats(geomB),
      source: canonical.source,
      submittedBy,
    });
    deleteSegment(canonical.id);
  });
  tx();

  return { newNodeId: midNode.id };
}
