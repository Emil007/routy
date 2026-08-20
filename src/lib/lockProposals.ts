import { db } from "./db";
import { directedPairIds, getSegment, lockSegment } from "./segments";
import { canEdit } from "./ownership";
import { getUser } from "./users";

export interface LockProposalRow {
  id: number;
  segmentId: number;
  requestedBy: number;
  reason: string | null;
  days: number;
  status: string;
  createdAt: string;
}

function rowToProposal(row: {
  id: number;
  segment_id: number;
  requested_by: number;
  reason: string | null;
  days: number;
  status: string;
  created_at: string;
}): LockProposalRow {
  return {
    id: row.id,
    segmentId: row.segment_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    days: row.days,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createLockProposal(
  segmentId: number,
  requestedBy: number,
  days: number,
  reason: string | null,
): LockProposalRow | null {
  const segment = getSegment(segmentId);
  if (!segment || segment.deletedAt) return null;
  const result = db
    .prepare(
      `INSERT INTO segment_lock_proposal (segment_id, requested_by, reason, days, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .run(segmentId, requestedBy, reason, days);
  return getLockProposal(Number(result.lastInsertRowid));
}

export function getLockProposal(id: number): LockProposalRow | null {
  const row = db
    .prepare(
      "SELECT id, segment_id, requested_by, reason, days, status, created_at FROM segment_lock_proposal WHERE id = ?",
    )
    .get(id) as
    | {
        id: number;
        segment_id: number;
        requested_by: number;
        reason: string | null;
        days: number;
        status: string;
        created_at: string;
      }
    | undefined;
  return row ? rowToProposal(row) : null;
}

export function listPendingLockProposalsForReviewer(userId: number, isAdmin: boolean): LockProposalRow[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.segment_id, p.requested_by, p.reason, p.days, p.status, p.created_at
       FROM segment_lock_proposal p
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC`,
    )
    .all() as {
    id: number;
    segment_id: number;
    requested_by: number;
    reason: string | null;
    days: number;
    status: string;
    created_at: string;
  }[];
  const reviewer = getUser(userId);
  if (!reviewer) return [];
  if (isAdmin) return rows.map(rowToProposal);
  return rows
    .filter((r) => {
      const seg = getSegment(r.segment_id);
      return seg && canEdit(reviewer, seg.submittedBy);
    })
    .map(rowToProposal);
}

export function dismissLockProposal(id: number): boolean {
  const proposal = getLockProposal(id);
  if (!proposal || proposal.status !== "pending") return false;
  db.prepare("UPDATE segment_lock_proposal SET status = 'dismissed' WHERE id = ?").run(id);
  return true;
}

export function approveLockProposal(id: number, approverId: number, isAdmin: boolean): boolean {
  const proposal = getLockProposal(id);
  if (!proposal || proposal.status !== "pending") return false;
  const segment = getSegment(proposal.segmentId);
  if (!segment) return false;
  if (!isAdmin && !canEdit(getUser(approverId)!, segment.submittedBy)) return false;
  const until = new Date(Date.now() + proposal.days * 86400000).toISOString();
  lockSegment(segment.id, until, proposal.reason);
  db.prepare("UPDATE segment_lock_proposal SET status = 'approved' WHERE id = ?").run(id);
  return true;
}

export function listPendingLockProposalsForSegment(segmentId: number): LockProposalRow[] {
  const ids = directedPairIds(segmentId);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, segment_id, requested_by, reason, days, status, created_at
       FROM segment_lock_proposal WHERE segment_id IN (${placeholders}) AND status = 'pending'`,
    )
    .all(...ids) as {
    id: number;
    segment_id: number;
    requested_by: number;
    reason: string | null;
    days: number;
    status: string;
    created_at: string;
  }[];
  return rows.map(rowToProposal);
}
