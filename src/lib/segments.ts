import { db } from "./db";
import { type LatLng, reversePoints, pathLengthMeters, estimateMinutes, elevationStats, closestPointOnPath, haversineMeters, REPOSITION_OFF_PATH_THRESHOLD_M } from "./geo";
import type { ElevationStats } from "./geo";
import { createNode, getNode, updateNodePosition, type NodeRow, type NodeNameParts } from "./nodes";
import { getUserTimezone } from "./timezoneServer";
import { toLocalDateKey, currentLocalDateKey } from "./timezone";

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
  name: string | null;
  deletedAt: string | null;
  lockedUntil: string | null;
  lockedReason: string | null;
  /** When true, only this directed edge is used in routing (sibling reverse is excluded). */
  oneWay: boolean;
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
  name: string | null;
  deleted_at: string | null;
  locked_until: string | null;
  locked_reason: string | null;
  one_way?: number | null;
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
    name: row.name,
    deletedAt: row.deleted_at,
    lockedUntil: row.locked_until,
    lockedReason: row.locked_reason,
    oneWay: row.one_way === 1,
    createdAt: row.created_at,
  };
}

/** True while `locked_until` is set and still in the future — excluded from new-route rotation until then. */
export function isSegmentLocked(segment: Pick<SegmentRow, "lockedUntil">): boolean {
  return segment.lockedUntil !== null && segment.lockedUntil > new Date().toISOString();
}

export function listSegments(): SegmentRow[] {
  const rows = db.prepare("SELECT * FROM segments WHERE active = 1 ORDER BY id").all() as SegmentDbRow[];
  return rows.map(mapSegment);
}

/** Soft-deleted segments, most recently deleted first — for the trash/restore UI. */
export function listDeletedSegments(): SegmentRow[] {
  const rows = db.prepare("SELECT * FROM segments WHERE active = 0 ORDER BY deleted_at DESC").all() as SegmentDbRow[];
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

/** Lower id of the two directed rows for one physical path. */
export function canonicalSegmentId(s: Pick<SegmentRow, "id" | "reverseOf">): number {
  return s.reverseOf !== null ? Math.min(s.id, s.reverseOf) : s.id;
}

/** Both directed segment ids for the same physical path (for avoid/condition mirroring). */
export function directedPairIds(segmentId: number): number[] {
  const segment = getSegment(segmentId);
  if (!segment) return [segmentId];
  const ids = new Set<number>([segment.id]);
  if (segment.reverseOf !== null) {
    ids.add(segment.reverseOf);
  } else {
    const reverse = db
      .prepare("SELECT id FROM segments WHERE reverse_of = ? AND deleted_at IS NULL LIMIT 1")
      .get(segment.id) as { id: number } | undefined;
    if (reverse) ids.add(reverse.id);
  }
  return [...ids];
}

/** A segment's name applies to the physical path regardless of direction, so both rows of the pair get it. */
export function renameSegment(segmentId: number, name: string | null): void {
  const segment = getSegment(segmentId);
  if (!segment) return;
  db.prepare("UPDATE segments SET name = ? WHERE id = ?").run(name, segment.id);
  if (segment.reverseOf !== null) {
    db.prepare("UPDATE segments SET name = ? WHERE id = ?").run(name, segment.reverseOf);
  }
}

/** Excludes a physical path from new-route generation until `until` (ISO datetime) — e.g. overgrown, construction. Applies to both rows of the pair. */
export function lockSegment(segmentId: number, until: string, reason: string | null): void {
  const segment = getSegment(segmentId);
  if (!segment) return;
  const tx = db.transaction(() => {
    db.prepare("UPDATE segments SET locked_until = ?, locked_reason = ? WHERE id = ?").run(until, reason, segment.id);
    if (segment.reverseOf !== null) {
      db.prepare("UPDATE segments SET locked_until = ?, locked_reason = ? WHERE id = ?").run(until, reason, segment.reverseOf);
    }
  });
  tx();
}

export function unlockSegment(segmentId: number): void {
  const segment = getSegment(segmentId);
  if (!segment) return;
  const tx = db.transaction(() => {
    db.prepare("UPDATE segments SET locked_until = NULL, locked_reason = NULL WHERE id = ?").run(segment.id);
    if (segment.reverseOf !== null) {
      db.prepare("UPDATE segments SET locked_until = NULL, locked_reason = NULL WHERE id = ?").run(segment.reverseOf);
    }
  });
  tx();
}

/**
 * Mark a directed segment as one-way for routing.
 * When `oneWay` is true: this row gets one_way=1 and its reverse sibling one_way=0.
 * When false: both rows of the pair are cleared.
 */
export function setSegmentOneWay(segmentId: number, oneWay: boolean): { ok: true } | { error: string } {
  const segment = getSegment(segmentId);
  if (!segment || segment.deletedAt) return { error: "not_found" };
  const siblingId = segment.reverseOf;
  const tx = db.transaction(() => {
    if (oneWay) {
      db.prepare("UPDATE segments SET one_way = 1 WHERE id = ?").run(segment.id);
      if (siblingId != null) {
        db.prepare("UPDATE segments SET one_way = 0 WHERE id = ?").run(siblingId);
      }
    } else {
      db.prepare("UPDATE segments SET one_way = 0 WHERE id = ?").run(segment.id);
      if (siblingId != null) {
        db.prepare("UPDATE segments SET one_way = 0 WHERE id = ?").run(siblingId);
      }
    }
  });
  tx();
  return { ok: true };
}

/** Other canonical segments connecting the exact same two nodes (either direction) — the "which one did I mean" case. */
export function findParallelSegments(segmentId: number): SegmentRow[] {
  const segment = getSegment(segmentId);
  if (!segment) return [];
  return listSegments()
    .filter(isCanonicalSegment)
    .filter((s) => s.id !== segment.id && s.reverseOf !== segment.id)
    .filter(
      (s) =>
        (s.startNodeId === segment.startNodeId && s.endNodeId === segment.endNodeId) ||
        (s.startNodeId === segment.endNodeId && s.endNodeId === segment.startNodeId),
    );
}

export interface NewSegmentInput {
  startNodeId: number;
  endNodeId: number;
  points: LatLng[];
  /** Client-supplied; IGNORED for the stored length since deep-review #1 — the
   *  geometry is the source of truth. Kept for call-sites that still pass it. */
  lengthM?: number;
  /** Client-supplied; IGNORED — estimated from the computed length and walk speed. */
  durationMin?: number;
  elevation: ElevationStats | null;
  /** Walk speed used to estimate duration. When omitted, the user's configured
   *  / default speed is used via estimateMinutes's default. */
  walkSpeedKmh?: number;
  source: "gpx" | "drawn";
  submittedBy: number;
}

/** F01/M1-1: a committed segment's endpoints must be near the chosen nodes —
 *  otherwise `lengthM` from a far-away geometry silently rewrites the network. */
export const SEGMENT_ENDPOINT_BAND_M = 50;

/**
 * Server-side length for a segment geometry — always recomputed from the points
 * (deep-review #1): a client-supplied lengthM is never trusted for what is
 * stored in the shared network or used to credit distance.
 */
export function segmentLengthFromPoints(points: LatLng[]): number {
  return Math.round(pathLengthMeters(points));
}

/** Inserts a segment and its automatic reverse-direction counterpart in one transaction. */
export function createSegmentWithReverse(input: NewSegmentInput): { forwardId: number; reverseId: number } {
  const lengthM = segmentLengthFromPoints(input.points);
  if (input.points.length >= 2) {
    const startNode = getNode(input.startNodeId);
    const endNode = getNode(input.endNodeId);
    if (startNode && haversineMeters(input.points[0], { lat: startNode.lat, lng: startNode.lng }) > SEGMENT_ENDPOINT_BAND_M) {
      throw new Error("start_node_distance_exceeds_band");
    }
    const last = input.points[input.points.length - 1]!;
    if (endNode && haversineMeters(last, { lat: endNode.lat, lng: endNode.lng }) > SEGMENT_ENDPOINT_BAND_M) {
      throw new Error("end_node_distance_exceeds_band");
    }
  }
  const inputWalkSpeed = input.walkSpeedKmh ?? 5;
  const durationMin = estimateMinutes(lengthM, inputWalkSpeed);
  const elevation = input.elevation;
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
        lengthM,
        durationMin,
        elevation?.gainM ?? null,
        elevation?.lossM ?? null,
        elevation?.minM ?? null,
        elevation?.maxM ?? null,
        input.source,
        input.submittedBy,
      );
    const forwardId = Number(forward.lastInsertRowid);

    const reversePts = reversePoints(input.points);
    const reverseElevation: ElevationStats | null = elevation
      ? {
          gainM: elevation.lossM,
          lossM: elevation.gainM,
          minM: elevation.minM,
          maxM: elevation.maxM,
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
        lengthM,
        durationMin,
        reverseElevation?.gainM ?? null,
        reverseElevation?.lossM ?? null,
        reverseElevation?.minM ?? null,
        reverseElevation?.maxM ?? null,
        input.source,
        forwardId,
        input.submittedBy,
      );
    const reverseId = Number(reverse.lastInsertRowid);
    db.prepare("UPDATE segments SET reverse_of = ? WHERE id = ?").run(reverseId, forwardId);

    return { forwardId, reverseId };
  });

  return tx();
}

/** Per-user lifetime walk counts by segment id. */
export function getUsageMap(userId: number): Map<number, number> {
  const rows = db
    .prepare("SELECT segment_id, usage_count FROM user_segment_usage WHERE user_id = ?")
    .all(userId) as { segment_id: number; usage_count: number }[];
  return new Map(rows.map((r) => [r.segment_id, r.usage_count]));
}

/** Per-user segment hits from walks accepted today (user's local timezone, decision G). */
export function getDailyUsageMap(userId: number): Map<number, number> {
  const tz = getUserTimezone(userId);
  const todayKey = currentLocalDateKey(tz);
  const rows = db.prepare("SELECT accepted_at, segment_ids FROM walk_log WHERE user_id = ?").all(userId) as {
    accepted_at: string;
    segment_ids: string;
  }[];
  const map = new Map<number, number>();
  for (const row of rows) {
    if (toLocalDateKey(row.accepted_at, tz) !== todayKey) continue;
    const ids = JSON.parse(row.segment_ids) as number[];
    for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

/**
 * Server-side real length (metres) of a route given its directed segment ids.
 * Returns null when any id is unknown or soft-deleted (F01/F02): the caller
 * must NOT fall back to a client-supplied length for point crediting. M28: every
 * directed id counts — a dead-end that walked a segment forward AND backward has
 * two different directed ids, both are real walked length (before, dedupe to the
 * canonical hid the second pass and under-billed out-and-backs). Unknown/soft-
 * deleted ids still yield null (route_stale).
 */
export function lengthFromSegmentIds(segmentIds: number[]): number | null {
  if (segmentIds.length === 0) return 0;
  let total = 0;
  for (const id of segmentIds) {
    const row = db.prepare("SELECT * FROM segments WHERE id = ?").get(id) as SegmentDbRow | undefined;
    if (!row || row.deleted_at !== null) return null;
    total += row.length_m;
  }
  return total;
}

export function recordWalk(
  userId: number,
  nodeChain: number[],
  segmentIds: number[],
  lengthM: number,
  durationMin: number,
  nickname: string | null = null,
): void {
  recordWalkWithPoints(userId, nodeChain, segmentIds, lengthM, durationMin, nickname, null);
}

export interface WalkPointsLedger {
  pointsEarned: number;
  pointsBase: number;
  pointsGolden: number;
  pointsExploration: number;
  pointsDiversity: number;
  streakMultiplier: number;
  celebrationTier: string;
  goldenHits: number;
}

/**
 * Inserts a walk (optionally with ledger points) and bumps usage.
 * When `claimActiveRoute` is true, deletes the user's active_route first;
 * returns null if no active route (double-complete safety).
 */
export function recordWalkWithPoints(
  userId: number,
  nodeChain: number[],
  segmentIds: number[],
  lengthM: number,
  durationMin: number,
  nickname: string | null,
  points: WalkPointsLedger | null,
  options: { claimActiveRoute?: boolean; freeRoamStartedAt?: number } = {},
): number | null {
  const claim = options.claimActiveRoute === true;
  return db.transaction(() => {
    if (claim) {
      const deleted = db.prepare("DELETE FROM active_route WHERE user_id = ?").run(userId);
      if (deleted.changes === 0) return null;
    }

    // M1-7 anti-replay (decision K refined): claim the session FIRST by inserting
    // the tombstone with walk_id NULL. If a concurrent request already claimed
    // this (user_id, started_at), the PK rejects our insert (changes === 0) and
    // we abort the transaction — the caller returns the already-credited walk
    // instead of booking a second one. When we win, the walk insert follows and
    // we backfill walk_id on the tombstone.
    const freeRoamStartedAt = options.freeRoamStartedAt;
    if (freeRoamStartedAt != null) {
      // Review-Fix: INSERT OR IGNORE — bei einem PK-Konflikt (paralleles Complete
      // derselben Session) wirft better-sqlite3 sonst eine Exception und rollt die
      // ganze Transaktion zurück (500), statt sauber `changes === 0` zu liefern.
      const claimed = db
        .prepare("INSERT OR IGNORE INTO free_roam_completed (user_id, started_at, walk_id) VALUES (?, ?, NULL)")
        .run(userId, freeRoamStartedAt);
      if (claimed.changes === 0) {
        return -1; // sentinel: session already spent
      }
    }

    const info = points
      ? db
          .prepare(
            `INSERT INTO walk_log (
              user_id, node_chain, segment_ids, length_m, duration_min, nickname,
              points_earned, points_base, points_golden, points_exploration, points_diversity,
              streak_multiplier, celebration_tier, golden_hits
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            JSON.stringify(nodeChain),
            JSON.stringify(segmentIds),
            lengthM,
            durationMin,
            nickname,
            points.pointsEarned,
            points.pointsBase,
            points.pointsGolden,
            points.pointsExploration,
            points.pointsDiversity,
            points.streakMultiplier,
            points.celebrationTier,
            points.goldenHits,
          )
      : db
          .prepare(
            "INSERT INTO walk_log (user_id, node_chain, segment_ids, length_m, duration_min, nickname) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(userId, JSON.stringify(nodeChain), JSON.stringify(segmentIds), lengthM, durationMin, nickname);

    const walkId = Number(info.lastInsertRowid);

    // Backfill walk_id on the tombstone we claimed above (decision K: the
    // already-credited walk id rides along with the marker).
    if (freeRoamStartedAt != null) {
      db.prepare("UPDATE free_roam_completed SET walk_id = ? WHERE user_id = ? AND started_at = ?").run(
        walkId,
        userId,
        freeRoamStartedAt,
      );
    }

    const bump = db.prepare(
      `INSERT INTO user_segment_usage (user_id, segment_id, usage_count, last_used_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, segment_id) DO UPDATE SET
         usage_count = usage_count + 1,
         last_used_at = datetime('now')`,
    );
    for (const id of segmentIds) bump.run(userId, id);

    return walkId;
  })();
}

/** Soft-deletes a segment and its reverse counterpart together — reversible via `restoreSegment`. */
export function deleteSegment(id: number): void {
  const segment = getSegment(id);
  if (!segment) return;
  const tx = db.transaction(() => {
    db.prepare("UPDATE segments SET active = 0, deleted_at = datetime('now') WHERE id = ?").run(segment.id);
    if (segment.reverseOf !== null) {
      db.prepare("UPDATE segments SET active = 0, deleted_at = datetime('now') WHERE id = ?").run(segment.reverseOf);
    }
  });
  tx();
}

export function restoreSegment(id: number): void {
  const segment = getSegment(id);
  if (!segment) return;
  const tx = db.transaction(() => {
    db.prepare("UPDATE segments SET active = 1, deleted_at = NULL WHERE id = ?").run(segment.id);
    if (segment.reverseOf !== null) {
      db.prepare("UPDATE segments SET active = 1, deleted_at = NULL WHERE id = ?").run(segment.reverseOf);
    }
  });
  tx();
}

/**
 * Irreversible. Because the forward/reverse pair reference each other via
 * `reverse_of` (both `ON DELETE CASCADE`), deleting either row automatically
 * deletes its counterpart (and cascades usage / history rows).
 */
export function purgeSegment(id: number): void {
  db.prepare("DELETE FROM segments WHERE id = ?").run(id);
}

/**
 * Removes a logged walk from a profile's history — e.g. one confirmed by
 * mistake. Reverses the usage-count bump `recordWalk` made for it so stats
 * don't stay inflated for a walk that no longer counts. Scoped to `userId` so
 * one profile can't delete another's history. Returns false if no matching
 * entry was found (already deleted, or belongs to someone else).
 */
export function deleteWalkLogEntry(id: number, userId: number): boolean {
  const row = db.prepare("SELECT segment_ids FROM walk_log WHERE id = ? AND user_id = ?").get(id, userId) as
    | { segment_ids: string }
    | undefined;
  if (!row) return false;

  const segmentIds = JSON.parse(row.segment_ids) as number[];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM walk_log WHERE id = ?").run(id);
    const decrement = db.prepare(
      `UPDATE user_segment_usage
       SET usage_count = MAX(0, usage_count - 1)
       WHERE user_id = ? AND segment_id = ?`,
    );
    for (const segId of segmentIds) decrement.run(userId, segId);
  });
  tx();
  return true;
}

function resolveCanonical(id: number): SegmentRow | null {
  const row = getSegment(id);
  if (!row) return null;
  if (isCanonicalSegment(row)) return row;
  return row.reverseOf !== null ? getSegment(row.reverseOf) : null;
}

/** Writes new geometry to a canonical/reverse pair, recomputing length/duration/elevation for both. */
function writeSegmentGeometry(
  canonical: SegmentRow,
  reverse: SegmentRow,
  points: LatLng[],
  walkSpeedKmh: number,
  durationOverrideMin?: number,
): void {
  const lengthM = Math.round(pathLengthMeters(points));
  const durationMin =
    durationOverrideMin != null && durationOverrideMin > 0
      ? Math.round(durationOverrideMin)
      : estimateMinutes(lengthM, walkSpeedKmh);
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
 * Rewrites a segment's shape (its two endpoints stay pinned to their nodes) — for
 * correcting the path, or adding/removing interior points, without changing what it
 * connects. The point count is free to differ from the current geometry.
 */
export function updateSegmentGeometry(
  segmentId: number,
  points: LatLng[],
  walkSpeedKmh: number,
  durationOverrideMin?: number,
): { ok: true } | { error: "not_found" | "too_few_points" } {
  const canonical = resolveCanonical(segmentId);
  if (!canonical || canonical.reverseOf === null) return { error: "not_found" };
  const reverse = getSegment(canonical.reverseOf);
  if (!reverse) return { error: "not_found" };
  if (points.length < 2) return { error: "too_few_points" };

  const fixedPoints = [...points];
  fixedPoints[0] = canonical.geometry[0];
  fixedPoints[fixedPoints.length - 1] = canonical.geometry[canonical.geometry.length - 1];
  const tx = db.transaction(() =>
    writeSegmentGeometry(canonical, reverse, fixedPoints, walkSpeedKmh, durationOverrideMin),
  );
  tx();
  return { ok: true };
}

/** Updates segment duration from GPS when the segment has no prior GPS-derived timing. */
export function applyGpsHopDurationIfMissing(
  segmentId: number,
  durationMin: number,
  opts: { walkUserId?: number | null; walkerIsAdmin?: boolean } = {},
): void {
  if (durationMin <= 0) return;
  const canonical = resolveCanonical(segmentId);
  if (!canonical || canonical.reverseOf === null) return;
  // F04: only the segment owner (submitted_by) or an admin may write timing that
  // other profiles' routes depend on; a stranger's fast/slow pass must not
  // re-time the shared network.
  if (opts.walkUserId != null && canonical.submittedBy != null && !opts.walkerIsAdmin) {
    if (canonical.submittedBy !== opts.walkUserId) return;
  }
  const row = db.prepare("SELECT duration_from_gps FROM segments WHERE id = ?").get(canonical.id) as
    | { duration_from_gps: number }
    | undefined;
  if (row?.duration_from_gps) return;
  const reverse = getSegment(canonical.reverseOf);
  if (!reverse) return;
  // F04: plausibility band — clip to walking speeds so a vehicle/fast hop or a
  // standstill doesn't retime the edge. No faster than 12 km/h, no slower than
  // 0.5 km/h over the (canonical) length.
  const lengthM = canonical.lengthM;
  const speedKmh = lengthM > 0 && durationMin > 0 ? (lengthM / 1000) / (durationMin / 60) : 0;
  if (speedKmh < 0.5 || speedKmh > 12) return;
  const rounded = Math.round(durationMin);
  db.prepare("UPDATE segments SET duration_min = ?, duration_from_gps = 1 WHERE id = ?").run(rounded, canonical.id);
  db.prepare("UPDATE segments SET duration_min = ?, duration_from_gps = 1 WHERE id = ?").run(rounded, reverse.id);
}

export { REPOSITION_OFF_PATH_THRESHOLD_M } from "./geo";

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

/** On-path: adjust incident segment endpoints and lengths. Off-path: keep old anchor via connector vertex + warning. */
export function repositionNode(
  nodeId: number,
  point: LatLng,
  walkSpeedKmh: number,
): { touchedSegments: number; offPathWarning: boolean; moveDistM: number } {
  const node = getNode(nodeId);
  if (!node) throw new Error("node_not_found");
  const before = { lat: node.lat, lng: node.lng };
  const moveDistM = haversineMeters(before, point);
  const offPathWarning = moveDistM > REPOSITION_OFF_PATH_THRESHOLD_M;

  const touching = listSegments()
    .filter(isCanonicalSegment)
    .filter((s) => s.startNodeId === nodeId || s.endNodeId === nodeId);

  const tx = db.transaction(() => {
    updateNodePosition(nodeId, point);
    for (const s of touching) {
      if (s.reverseOf === null) continue;
      const reverse = getSegment(s.reverseOf);
      if (!reverse) continue;
      let geometry = [...s.geometry];
      if (offPathWarning) {
        if (s.startNodeId === nodeId) {
          geometry = [point, before, ...geometry.slice(1)];
        } else if (s.endNodeId === nodeId) {
          geometry = [...geometry.slice(0, -1), before, point];
        }
      } else {
        if (s.startNodeId === nodeId) geometry[0] = point;
        if (s.endNodeId === nodeId) geometry[geometry.length - 1] = point;
      }
      writeSegmentGeometry(s, reverse, geometry, walkSpeedKmh);
    }
  });
  tx();
  return { touchedSegments: touching.length, offPathWarning, moveDistM: Math.round(moveDistM) };
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
  endpoint: { nodeId: number } | { newName: string | null; nameParts?: NodeNameParts },
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
    midNode = createNode(endpoint.newName, closest.point, false, submittedBy, endpoint.nameParts);
  }

  const tx = db.transaction(() => {
    createSegmentWithReverse({
      startNodeId: canonical.startNodeId,
      endNodeId: midNode.id,
      points: geomA,
      elevation: elevationStats(geomA),
      source: canonical.source,
      submittedBy,
      walkSpeedKmh,
    });
    createSegmentWithReverse({
      startNodeId: midNode.id,
      endNodeId: canonical.endNodeId,
      points: geomB,
      elevation: elevationStats(geomB),
      source: canonical.source,
      submittedBy,
      walkSpeedKmh,
    });
    deleteSegment(canonical.id);
  });
  tx();

  return { newNodeId: midNode.id };
}

