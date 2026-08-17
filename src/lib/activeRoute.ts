import { db } from "./db";

export interface ActiveRouteRow {
  userId: number;
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  acceptedAt: string;
}

interface ActiveRouteDbRow {
  user_id: number;
  node_chain: string;
  segment_ids: string;
  length_m: number;
  duration_min: number;
  accepted_at: string;
}

function mapRow(row: ActiveRouteDbRow): ActiveRouteRow {
  return {
    userId: row.user_id,
    nodeChain: JSON.parse(row.node_chain) as number[],
    segmentIds: JSON.parse(row.segment_ids) as number[],
    lengthM: row.length_m,
    durationMin: row.duration_min,
    acceptedAt: row.accepted_at,
  };
}

export function getActiveRoute(userId: number): ActiveRouteRow | null {
  const row = db.prepare("SELECT * FROM active_route WHERE user_id = ?").get(userId) as ActiveRouteDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function setActiveRoute(
  userId: number,
  route: { nodeChain: number[]; segmentIds: number[]; lengthM: number; durationMin: number },
): void {
  db.prepare(
    `INSERT INTO active_route (user_id, node_chain, segment_ids, length_m, duration_min)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       node_chain = excluded.node_chain,
       segment_ids = excluded.segment_ids,
       length_m = excluded.length_m,
       duration_min = excluded.duration_min,
       accepted_at = datetime('now')`,
  ).run(userId, JSON.stringify(route.nodeChain), JSON.stringify(route.segmentIds), route.lengthM, route.durationMin);
}

export function clearActiveRoute(userId: number): void {
  db.prepare("DELETE FROM active_route WHERE user_id = ?").run(userId);
}

/** Across all profiles — the shared path network shouldn't lose a node/segment someone is mid-walk on. */
export function nodeUsedByActiveRoute(nodeId: number): boolean {
  const rows = db.prepare("SELECT node_chain FROM active_route").all() as { node_chain: string }[];
  return rows.some((r) => (JSON.parse(r.node_chain) as number[]).includes(nodeId));
}

export function segmentUsedByActiveRoute(segmentIds: number[]): boolean {
  if (segmentIds.length === 0) return false;
  const rows = db.prepare("SELECT segment_ids FROM active_route").all() as { segment_ids: string }[];
  return rows.some((r) => {
    const used = JSON.parse(r.segment_ids) as number[];
    return segmentIds.some((id) => used.includes(id));
  });
}
