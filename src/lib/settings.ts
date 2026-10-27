import { db } from "./db";

export interface Settings {
  merge_radius_m: number;
  name_far_warn_m: number;
  tolerance_percent: number;
  widen_step_percent: number;
  widen_max_percent: number;
  daily_diversity_weight: number;
  walk_speed_kmh: number;
  suggest_min_km: number;
  suggest_max_km: number;
  adjust_step_percent: number;
  /** Daily golden share of canonical network (1–25). */
  golden_percent: number;
}

export const DEFAULT_SETTINGS: Settings = {
  merge_radius_m: 50,
  name_far_warn_m: 300,
  tolerance_percent: 10,
  widen_step_percent: 5,
  widen_max_percent: 30,
  daily_diversity_weight: 1,
  walk_speed_kmh: 5,
  suggest_min_km: 2,
  suggest_max_km: 5,
  adjust_step_percent: 25,
  golden_percent: 5,
};

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/**
 * Sanity bounds per setting — prevents self-sabotage via the admin form
 * (decision H, review #3 M). Applied on read AND on write so even hand-edited
 * DB values can't break routing.
 */
export const SETTINGS_CLAMPS: Partial<Record<keyof Settings, { min: number; max: number }>> = {
  merge_radius_m: { min: 1, max: 200 },
  name_far_warn_m: { min: 10, max: 2000 },
  tolerance_percent: { min: 5, max: 100 },
  widen_step_percent: { min: 1, max: 50 },
  widen_max_percent: { min: 1, max: 80 },
  daily_diversity_weight: { min: 0.5, max: 5 },
  walk_speed_kmh: { min: 1, max: 20 },
  suggest_min_km: { min: 0.3, max: 60 },
  suggest_max_km: { min: 0.5, max: 100 },
  adjust_step_percent: { min: 1, max: 50 },
  golden_percent: { min: 1, max: 25 },
};

export function clampSetting(key: keyof Settings, value: number): number {
  const c = SETTINGS_CLAMPS[key];
  if (!c) return value;
  return Math.min(c.max, Math.max(c.min, value));
}

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    const raw = stored.get(key);
    if (raw !== undefined) {
      const num = Number(raw);
      if (!Number.isNaN(num)) {
        result[key] = clampSetting(key, num);
      } else {
        result[key] = DEFAULT_SETTINGS[key];
      }
    }
  }
  // Cross-field consistency: min must stay <= max.
  if (result.suggest_min_km > result.suggest_max_km) {
    result.suggest_max_km = result.suggest_min_km;
  }
  return result;
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction((entries: [string, number][]) => {
    for (const [key, value] of entries) stmt.run(key, String(value));
  });
  const entries = SETTINGS_KEYS.filter((k) => partial[k] !== undefined).map(
    (k) => [k, clampSetting(k, partial[k] as number)] as [string, number],
  );
  if (entries.length) tx(entries);
  return getSettings();
}

/** A profile's own walking speed, if they've set one, else the network-wide default. */
export function effectiveWalkSpeedKmh(userWalkSpeedKmh: number | null, settings: Settings): number {
  return userWalkSpeedKmh ?? settings.walk_speed_kmh;
}
