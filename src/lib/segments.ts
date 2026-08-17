import { db } from "./db";
import { type LatLng, reversePoints } from "./geo";
import type { ElevationStats } from "./geo";

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
