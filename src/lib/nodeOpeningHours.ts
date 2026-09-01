import type { NodeRow } from "./nodes";

/** Minutes from midnight (0–1439) in the client's local timezone at check time. */
export function localMinutesFromMidnight(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Whether a node is open at the given instant (local time). Null hours = always open. */
export function isNodeOpenAt(
  node: Pick<NodeRow, "openFromMinutes" | "openUntilMinutes">,
  date = new Date(),
): boolean {
  const from = node.openFromMinutes;
  const until = node.openUntilMinutes;
  if (from == null && until == null) return true;
  if (from == null || until == null) return false;

  const now = localMinutesFromMidnight(date);
  if (from === until) return true;
  if (from < until) return now >= from && now < until;
  // Overnight window (e.g. 22:00–06:00)
  return now >= from || now < until;
}

/** Node ids that are closed at the given instant. */
export function closedNodeIds(
  nodes: Pick<NodeRow, "id" | "openFromMinutes" | "openUntilMinutes">[],
  date = new Date(),
): number[] {
  return nodes.filter((n) => !isNodeOpenAt(n, date)).map((n) => n.id);
}
