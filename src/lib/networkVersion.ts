import { createHash } from "node:crypto";
import { db } from "./db";

/** Cheap fingerprint of the path network — bumps when nodes/segments change. */
export function getNetworkVersion(): string {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM nodes WHERE active = 1) AS node_count,
         (SELECT COUNT(*) FROM segments WHERE active = 1) AS segment_count,
         (SELECT COALESCE(MAX(id), 0) FROM nodes) AS max_node_id,
         (SELECT COALESCE(MAX(id), 0) FROM segments) AS max_segment_id,
         (SELECT COALESCE(MAX(updated_at), MAX(created_at), '') FROM nodes) AS node_updated,
         (SELECT COALESCE(MAX(updated_at), MAX(created_at), '') FROM segments) AS segment_updated`,
    )
    .get() as {
    node_count: number;
    segment_count: number;
    max_node_id: number;
    max_segment_id: number;
    node_updated: string;
    segment_updated: string;
  };

  const payload = `${row.node_count}:${row.segment_count}:${row.max_node_id}:${row.max_segment_id}:${row.node_updated}:${row.segment_updated}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
