import { db } from "./db";

export interface Settings {
  merge_radius_m: number;
  name_far_warn_m: number;
  tolerance_percent: number;
  widen_step_percent: number;
  widen_max_percent: number;
  daily_diversity_weight: number;
  walk_speed_kmh: number;
}

export const DEFAULT_SETTINGS: Settings = {
  merge_radius_m: 50,
  name_far_warn_m: 300,
  tolerance_percent: 10,
  widen_step_percent: 5,
  widen_max_percent: 30,
  daily_diversity_weight: 1,
  walk_speed_kmh: 5,
};

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    const raw = stored.get(key);
    if (raw !== undefined) {
      const num = Number(raw);
      if (!Number.isNaN(num)) result[key] = num;
    }
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
    (k) => [k, partial[k] as number] as [string, number],
  );
  if (entries.length) tx(entries);
  return getSettings();
}
