import { listSegments } from "./segments";
import { getUserHomeNodeId } from "./nodes";

/**
 * Directed segment ids incident to the user's home node (house connectors).
 *
 * Scope (Phase L, Emanuel 2026-08-23): these are ignored **only for route-generation
 * scoring / point preview** — so the generator does not force both connectors or reject
 * loops because of house-spur penalties. They are still drawn, still walked, still
 * traversed by the search, and — when actually walked — counted exactly like every other
 * path in stats / points / usage / exploration totals (the 0.41 stats exclusion was
 * reverted). Do NOT reuse this for stats.
 */
export function getHomeAccessSegmentIds(userId: number): Set<number> {
  const homeId = getUserHomeNodeId(userId);
  if (homeId == null) return new Set();
  const ids = new Set<number>();
  for (const s of listSegments()) {
    if (s.deletedAt) continue;
    if (s.startNodeId === homeId || s.endNodeId === homeId) ids.add(s.id);
  }
  return ids;
}
