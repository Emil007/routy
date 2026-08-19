import { db } from "./db";
import { listSegments, getSegment, type SegmentRow } from "./segments";
import { closestPointOnPath, haversineMeters, pathLengthMeters, type LatLng } from "./geo";
import { getNode } from "./nodes";

const NEAR_SEGMENT_M = 25;
const MIN_INTERIOR_FRACTION = 0.12;
const SAMPLE_EVERY_N = 8;
const MIN_PROPOSAL_SPACING_M = 40;

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
  const rows = db
    .prepare(
      "SELECT lat, lng FROM segment_proposal WHERE segment_id = ? AND status = 'pending'",
    )
    .all(segmentId) as { lat: number; lng: number }[];
  const query = { lat, lng };
  return rows.some((r) => haversineMeters(query, r) < MIN_PROPOSAL_SPACING_M);
}

function findBestSegmentMatch(point: LatLng, segments: SegmentRow[]): { segment: SegmentRow; splitPoint: LatLng } | null {
  let best: { segment: SegmentRow; splitPoint: LatLng; distanceM: number } | null = null;
  for (const segment of segments) {
    const closest = closestPointOnPath(segment.geometry, point);
    if (!closest || closest.distanceM > NEAR_SEGMENT_M) continue;
    if (!isInteriorPoint(segment, closest.point, closest.index)) continue;
    if (!best || closest.distanceM < best.distanceM) {
      best = { segment, splitPoint: closest.point, distanceM: closest.distanceM };
    }
  }
  return best ? { segment: best.segment, splitPoint: best.splitPoint } : null;
}

/** After a GPX track is saved, detect interior points near existing segments and queue split proposals. */
export function detectProposalsFromTrack(points: LatLng[], createdBy: number): number {
  if (points.length < 2) return 0;

  const segments = listSegments().filter((s) => s.reverseOf === null);
  let created = 0;

  for (let i = 0; i < points.length; i += SAMPLE_EVERY_N) {
    const point = points[i];
    const match = findBestSegmentMatch(point, segments);
    if (!match) continue;
    const { segment, splitPoint } = match;
    if (hasNearbyPendingProposal(segment.id, splitPoint.lat, splitPoint.lng)) continue;

    db.prepare(
      "INSERT INTO segment_proposal (segment_id, lat, lng, status, created_by) VALUES (?, ?, ?, 'pending', ?)",
    ).run(segment.id, splitPoint.lat, splitPoint.lng, createdBy);
    created++;
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
