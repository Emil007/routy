import { db } from "./db";
import { DEFAULT_TIMEZONE, toLocalHour } from "./timezone";

/**
 * Server-only timezone helpers that touch the database.
 * Kept separate from `timezone.ts` so client components (TimezoneSelectForm)
 * never pull better-sqlite3 / node:fs into the browser bundle.
 */

export function getUserTimezone(userId: number): string {
  const row = db.prepare("SELECT timezone FROM users WHERE id = ?").get(userId) as
    | { timezone: string | null }
    | undefined;
  return row?.timezone && row.timezone.trim() !== "" ? row.timezone : DEFAULT_TIMEZONE;
}

/** How many of the user's walks fall within an inclusive local hour range (0–23). */
export function countWalksInLocalHourRange(userId: number, fromHour: number, toHour: number): number {
  const timezone = getUserTimezone(userId);
  const rows = db.prepare("SELECT accepted_at FROM walk_log WHERE user_id = ?").all(userId) as {
    accepted_at: string;
  }[];
  return rows.filter((r) => {
    const h = toLocalHour(r.accepted_at, timezone);
    return h >= fromHour && h <= toHour;
  }).length;
}
