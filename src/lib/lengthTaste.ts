import { db } from "./db";
import { getSettings } from "./settings";

export type LengthPreset = "short" | "normal" | "long" | "surprise";

export interface LengthBand {
  minM: number;
  maxM: number;
  targetM: number;
  /** True when falling back to network suggest_min/max (fewer than 3 ratings). */
  usingNetworkFallback: boolean;
}

const RATING_COUNT_THRESHOLD = 3;

/** Map UI rating 1–5 → short/normal/long bucket. */
export function ratingToBucket(rating: 1 | 2 | 3 | 4 | 5): "short" | "normal" | "long" {
  if (rating <= 2) return "short";
  if (rating === 3) return "normal";
  return "long";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function getUserTasteColumns(userId: number): {
  taste_short_m: number | null;
  taste_normal_m: number | null;
  taste_long_m: number | null;
} {
  const row = db
    .prepare("SELECT taste_short_m, taste_normal_m, taste_long_m FROM users WHERE id = ?")
    .get(userId) as
    | { taste_short_m: number | null; taste_normal_m: number | null; taste_long_m: number | null }
    | undefined;
  return row ?? { taste_short_m: null, taste_normal_m: null, taste_long_m: null };
}

function countLengthRatings(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM walk_log WHERE user_id = ? AND length_rating IS NOT NULL")
    .get(userId) as { c: number };
  return row.c;
}

/** Recompute taste_* medians from rated walks; interpolate empty buckets. */
export function recomputeUserLengthTaste(userId: number): void {
  const rows = db
    .prepare(
      "SELECT length_m, length_rating FROM walk_log WHERE user_id = ? AND length_rating IS NOT NULL",
    )
    .all(userId) as { length_m: number; length_rating: number }[];

  const buckets: Record<"short" | "normal" | "long", number[]> = {
    short: [],
    normal: [],
    long: [],
  };
  for (const row of rows) {
    const rating = row.length_rating as 1 | 2 | 3 | 4 | 5;
    if (rating < 1 || rating > 5) continue;
    buckets[ratingToBucket(rating)].push(row.length_m);
  }

  let shortM = median(buckets.short);
  let normalM = median(buckets.normal);
  let longM = median(buckets.long);

  // Interpolate empty buckets from neighbors / network defaults.
  const settings = getSettings();
  const netMid = ((settings.suggest_min_km + settings.suggest_max_km) / 2) * 1000;
  if (shortM == null && normalM != null) shortM = normalM * 0.7;
  if (longM == null && normalM != null) longM = normalM * 1.35;
  if (normalM == null && shortM != null && longM != null) normalM = (shortM + longM) / 2;
  if (normalM == null && shortM != null) normalM = shortM * 1.3;
  if (normalM == null && longM != null) normalM = longM * 0.75;
  if (shortM == null && longM != null) shortM = longM * 0.55;
  if (longM == null && shortM != null) longM = shortM * 1.8;
  if (shortM == null) shortM = settings.suggest_min_km * 1000;
  if (normalM == null) normalM = netMid;
  if (longM == null) longM = settings.suggest_max_km * 1000;

  // Keep order short ≤ normal ≤ long.
  const ordered = [shortM, normalM, longM].sort((a, b) => a - b);
  shortM = ordered[0]!;
  normalM = ordered[1]!;
  longM = ordered[2]!;

  db.prepare(
    "UPDATE users SET taste_short_m = ?, taste_normal_m = ?, taste_long_m = ? WHERE id = ?",
  ).run(shortM, normalM, longM, userId);
}

export function setWalkLengthRating(walkId: number, userId: number, rating: 1 | 2 | 3 | 4 | 5): boolean {
  const result = db
    .prepare("UPDATE walk_log SET length_rating = ? WHERE id = ? AND user_id = ?")
    .run(rating, walkId, userId);
  if (result.changes === 0) return false;
  recomputeUserLengthTaste(userId);
  return true;
}

/**
 * Length band for generate. Network suggest_min/max until 3 ratings; then per-user taste.
 * Surprise uses the full short–long span (or network full band).
 */
export function lengthBandForUser(userId: number, preset: LengthPreset | undefined): LengthBand {
  const settings = getSettings();
  const netMin = settings.suggest_min_km * 1000;
  const netMax = settings.suggest_max_km * 1000;
  const usingNetworkFallback = countLengthRatings(userId) < RATING_COUNT_THRESHOLD;
  const taste = getUserTasteColumns(userId);

  if (usingNetworkFallback || taste.taste_short_m == null || taste.taste_normal_m == null || taste.taste_long_m == null) {
    const mid = (netMin + netMax) / 2;
    if (preset === "short") {
      return { minM: netMin, maxM: mid, targetM: (netMin + mid) / 2, usingNetworkFallback: true };
    }
    if (preset === "long") {
      return { minM: mid, maxM: netMax, targetM: (mid + netMax) / 2, usingNetworkFallback: true };
    }
    // normal + surprise → full network band
    return { minM: netMin, maxM: netMax, targetM: mid, usingNetworkFallback: true };
  }

  const short = taste.taste_short_m;
  const normal = taste.taste_normal_m;
  const long = taste.taste_long_m;
  const halfShort = Math.max(200, (normal - short) / 2);
  const halfLong = Math.max(200, (long - normal) / 2);

  if (preset === "short") {
    return {
      minM: Math.max(200, short - halfShort),
      maxM: short + halfShort,
      targetM: short,
      usingNetworkFallback: false,
    };
  }
  if (preset === "long") {
    return {
      minM: Math.max(200, long - halfLong),
      maxM: long + halfLong,
      targetM: long,
      usingNetworkFallback: false,
    };
  }
  if (preset === "normal") {
    return {
      minM: Math.max(200, normal - halfShort),
      maxM: normal + halfLong,
      targetM: normal,
      usingNetworkFallback: false,
    };
  }
  // surprise: full personal span
  return {
    minM: Math.max(200, short - halfShort),
    maxM: long + halfLong,
    targetM: normal,
    usingNetworkFallback: false,
  };
}
