import type { NodeRow } from "./nodes";
import { toLocalHour } from "./timezone";

/** Minutes from midnight (0–1439) in the given IANA zone at the given instant.
 *  Falls back to the host clock when no zone is supplied (legacy behavior). */
export function localMinutesFromMidnight(
  date: Date = new Date(),
  timezone?: string,
): number {
  if (!timezone) return date.getHours() * 60 + date.getMinutes();
  const hour = toLocalHour(date.toISOString(), timezone);
  if (hour < 0) return date.getHours() * 60 + date.getMinutes();
  const minutes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "2-digit",
  }).formatToParts(date);
  const minute = Number(minutes.find((p) => p.type === "minute")?.value);
  return hour * 60 + (Number.isNaN(minute) ? 0 : minute);
}

/** Whether a node is open at the given instant (local time). Null hours = always open. */
export function isNodeOpenAt(
  node: Pick<NodeRow, "openFromMinutes" | "openUntilMinutes">,
  date: Date = new Date(),
  timezone?: string,
): boolean {
  const from = node.openFromMinutes;
  const until = node.openUntilMinutes;
  if (from == null && until == null) return true;
  if (from == null || until == null) return false;

  const now = localMinutesFromMidnight(date, timezone);
  if (from === until) return true;
  if (from < until) return now >= from && now < until;
  // Overnight window (e.g. 22:00–06:00)
  return now >= from || now < until;
}

/** Node ids that are closed at the given instant. */
export function closedNodeIds(
  nodes: Pick<NodeRow, "id" | "openFromMinutes" | "openUntilMinutes">[],
  date: Date = new Date(),
  timezone?: string,
): number[] {
  return nodes.filter((n) => !isNodeOpenAt(n, date, timezone)).map((n) => n.id);
}
