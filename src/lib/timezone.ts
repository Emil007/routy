/** Default IANA zone for all users (per-user override lives in users.timezone). */
export const DEFAULT_TIMEZONE = "Europe/Vienna";

/** Curated IANA zones — enough for a household, avoids dumping 400 entries into the select. */
export const TIMEZONES = [
  "Europe/Vienna",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Paris",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Prague",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
] as const;

export type Timezone = (typeof TIMEZONES)[number];

export function isTimezone(value: string | null | undefined): value is Timezone {
  return !!value && (TIMEZONES as readonly string[]).includes(value);
}

/** Local calendar date (YYYY-MM-DD) for an ISO timestamp, in the given IANA zone. */
export function toLocalDateKey(isoTs: string | null | undefined, tz: string): string {
  if (!isoTs) return "";
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Current local calendar date key in the given zone. */
export function currentLocalDateKey(tz: string): string {
  return toLocalDateKey(new Date().toISOString(), tz);
}

/** Local hour (0–23) in the given zone for an ISO timestamp; -1 if unparseable. */
export function toLocalHour(isoTs: string | null | undefined, tz: string): number {
  if (!isoTs) return -1;
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return -1;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).formatToParts(d);
  const raw = Number(parts.find((p) => p.type === "hour")?.value);
  if (Number.isNaN(raw)) return -1;
  // "24" appears at midnight in some engines — normalize to 0.
  return raw === 24 ? 0 : raw;
}


