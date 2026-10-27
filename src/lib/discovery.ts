import { db } from "./db";
import { listSegments, getSegment, isCanonicalSegment, type SegmentRow } from "./segments";
import { closestPointOnPath, haversineMeters, pathLengthMeters, bearing, type LatLng } from "./geo";
import { getNode, listNodes } from "./nodes";

const NEAR_SEGMENT_M = 35;
const MIN_INTERIOR_FRACTION = 0.06;
const SAMPLE_EVERY_N = 4;
const MIN_PROPOSAL_SPACING_M = 40;
/** Skip a split proposal that sits right on top of an existing junction node. */
const NEAR_EXISTING_NODE_M = 22;
/** Safety cap on proposals per committed track so the map list stays usable. */
const MAX_PROPOSALS_PER_TRACK = 24;
/** Downsample very long tracks before processing so CPU stays bounded even at the 10k API cap. */
const MAX_TRACK_SAMPLES = 5000;

/** Evenly down-sample a track list so it has at most MAX_TRACK_SAMPLES points (keeps first & last). */
export function capTrackPoints(points: LatLng[]): LatLng[] {
  if (points.length <= MAX_TRACK_SAMPLES) return points;
  const stride = Math.max(1, Math.ceil((points.length - 2) / (MAX_TRACK_SAMPLES - 2)));
  const out: LatLng[] = [points[0]!];
  for (let i = stride; i < points.length - 1; i += stride) out.push(points[i]!);
  out.push(points[points.length - 1]!);
  return out;
}

export interface SegmentProposalRow {
  id: number;
  segmentId: number;
  lat: number;
  lng: number;
  status: "pending" | "accepted" | "dismissed";
  createdBy: number;
  createdAt: string;
}

function rowFromDb(r: {
  id: number;
  segment_id: number;
  lat: number;
  lng: number;
  status: string;
  created_by: number;
  created_at: string;
}): SegmentProposalRow {
  return {
    id: r.id,
    segmentId: r.segment_id,
    lat: r.lat,
    lng: r.lng,
    status: r.status as SegmentProposalRow["status"],
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function isInteriorPoint(segment: SegmentRow, point: LatLng, closestIndex: number): boolean {
  const totalLen = pathLengthMeters(segment.geometry);
  if (totalLen < 20) return false;

  let distFromStart = 0;
  for (let i = 0; i < closestIndex; i++) {
    distFromStart += haversineMeters(segment.geometry[i], segment.geometry[i + 1]);
  }
  distFromStart += haversineMeters(segment.geometry[closestIndex], point);

  const frac = distFromStart / totalLen;
  return frac >= MIN_INTERIOR_FRACTION && frac <= 1 - MIN_INTERIOR_FRACTION;
}

function hasNearbyPendingProposal(segmentId: number, lat: number, lng: number): boolean {
  // Same-segment dedupe (within MIN_PROPOSAL_SPACING_M) plus a cross-segment
  // guard: proposals closer than half the spacing on ANY segment represent the
  // same physical crossing (a junction often brushes several segments at once),
  // so we avoid flooding the map with near-duplicate split points.
  const rows = db
    .prepare(
      "SELECT segment_id, lat, lng FROM segment_proposal WHERE status = 'pending'",
    )
    .all() as { segment_id: number; lat: number; lng: number }[];
  const query = { lat, lng };
  return rows.some(
    (r) =>
      r.segment_id === segmentId
        ? haversineMeters(query, { lat: r.lat, lng: r.lng }) < MIN_PROPOSAL_SPACING_M
        : haversineMeters(query, { lat: r.lat, lng: r.lng }) < MIN_PROPOSAL_SPACING_M / 2,
  );
}

function findBestSegmentMatch(
  point: LatLng,
  segments: SegmentRow[],
  trackBearingDeg?: number | null,
): { segment: SegmentRow; splitPoint: LatLng } | null {
  let best: { segment: SegmentRow; splitPoint: LatLng; distanceM: number; score: number } | null = null;
  for (const segment of segments) {
    const closest = closestPointOnPath(segment.geometry, point);
    if (!closest || closest.distanceM > NEAR_SEGMENT_M) continue;
    if (!isInteriorPoint(segment, closest.point, closest.index)) continue;
    // Score: distance dominates, but a perpendicular crossing (angle difference
    // near 90°) is preferred over brushing alongside the same segment. This cuts
    // down on trivial same-street corner proposals while keeping genuine
    // junctions — the ones worth splitting a segment for.
    const distScore = closest.distanceM;
    let angleScore = 0;
    if (trackBearingDeg != null && segment.geometry.length >= 2) {
      const segBearing = bearing(segment.geometry[0], segment.geometry[segment.geometry.length - 1]);
      const diff = Math.abs(((trackBearingDeg - segBearing + 540) % 360) - 180);
      angleScore = Math.min(diff, 180 - diff); // 0 = parallel, 90 = perpendicular
    }
    const score = distScore - angleScore * 0.5;
    if (!best || score < best.score) {
      best = { segment, splitPoint: closest.point, distanceM: closest.distanceM, score };
    }
  }
  return best ? { segment: best.segment, splitPoint: best.splitPoint } : null;
}

/** After a GPX track is saved, detect interior points near existing segments and queue split proposals. */
export function detectProposalsFromTrack(points: LatLng[], createdBy: number): number {
  if (points.length < 2) return 0;
  // Bound CPU on very long tracks (API allows up to 10k points): down-sample
  // evenly before the per-sample network scan.
  points = capTrackPoints(points);

  // Only one row per physical path (the lower id of each forward/reverse pair).
  // Filtering on `reverseOf === null` matched almost nothing because the schema
  // stores every path as a pair whose reverse_of columns point at each other —
  // which is why proposal detection used to find far fewer junctions than a
  // recording actually crossed.
  const segments = listSegments().filter(isCanonicalSegment);
  const nodeCoords = listNodes().map((n) => ({ lat: n.lat, lng: n.lng }));
  let created = 0;

  for (let i = 0; i < points.length; i += SAMPLE_EVERY_N) {
    const point = points[i];
    // Local track bearing from the surrounding samples helps prefer genuine
    // crossings over parallel brushing.
    const prev = points[Math.max(0, i - SAMPLE_EVERY_N)];
    const next = points[Math.min(points.length - 1, i + SAMPLE_EVERY_N)];
    const trackBearingDeg =
      haversineMeters(prev, point) + haversineMeters(point, next) > 1
        ? bearing(prev, next)
        : null;
    const match = findBestSegmentMatch(point, segments, trackBearingDeg);
    if (!match) continue;
    const { segment, splitPoint } = match;
    if (hasNearbyPendingProposal(segment.id, splitPoint.lat, splitPoint.lng)) continue;
    // Don't propose a split where a junction node already exists — the crossing
    // is already represented in the network.
    const nearExistingNode = nodeCoords.some(
      (n) => haversineMeters({ lat: n.lat, lng: n.lng }, splitPoint) < NEAR_EXISTING_NODE_M,
    );
    if (nearExistingNode) continue;

    db.prepare(
      "INSERT INTO segment_proposal (segment_id, lat, lng, status, created_by) VALUES (?, ?, ?, 'pending', ?)",
    ).run(segment.id, splitPoint.lat, splitPoint.lng, createdBy);
    created++;
    if (created >= MAX_PROPOSALS_PER_TRACK) break;
  }

  return created;
}

export function listPendingProposals(): SegmentProposalRow[] {
  const rows = db
    .prepare(
      "SELECT id, segment_id, lat, lng, status, created_by, created_at FROM segment_proposal WHERE status = 'pending' ORDER BY created_at DESC",
    )
    .all() as {
    id: number;
    segment_id: number;
    lat: number;
    lng: number;
    status: string;
    created_by: number;
    created_at: string;
  }[];
  return rows.map(rowFromDb);
}

export function getProposal(id: number): SegmentProposalRow | null {
  const row = db
    .prepare(
      "SELECT id, segment_id, lat, lng, status, created_by, created_at FROM segment_proposal WHERE id = ?",
    )
    .get(id) as
    | {
        id: number;
        segment_id: number;
        lat: number;
        lng: number;
        status: string;
        created_by: number;
        created_at: string;
      }
    | undefined;
  return row ? rowFromDb(row) : null;
}

export function dismissProposal(id: number): boolean {
  const proposal = getProposal(id);
  if (!proposal || proposal.status !== "pending") return false;
  db.prepare("UPDATE segment_proposal SET status = 'dismissed' WHERE id = ?").run(id);
  return true;
}

export function acceptProposal(id: number): boolean {
  const proposal = getProposal(id);
  if (!proposal || proposal.status !== "pending") return false;
  const segment = getSegment(proposal.segmentId);
  if (!segment || segment.deletedAt) return false;
  const start = getNode(segment.startNodeId);
  const end = getNode(segment.endNodeId);
  if (!start || !end) return false;
  db.prepare("UPDATE segment_proposal SET status = 'accepted' WHERE id = ?").run(id);
  return true;
}
