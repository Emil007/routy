"use client";

import { useState } from "react";
import { TILE_LAYERS, type BaseLayerId } from "./MapView";
import { t, type Locale } from "@/lib/i18n";

const STORAGE_KEY = "routy.mapPreferences";

export interface MapPreferences {
  baseLayerId: BaseLayerId;
  showTrails: boolean;
}

const DEFAULTS: MapPreferences = { baseLayerId: "streets", showTrails: false };

function readStored(): MapPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MapPreferences>;
    const baseLayerId = TILE_LAYERS.some((l) => l.id === parsed.baseLayerId)
      ? (parsed.baseLayerId as BaseLayerId)
      : DEFAULTS.baseLayerId;
    return { baseLayerId, showTrails: parsed.showTrails === true };
  } catch {
    return DEFAULTS;
  }
}

export function MapPreferencesForm({ locale }: { locale: Locale }) {
  const [prefs, setPrefsState] = useState<MapPreferences>(() => readStored());

  const setPrefs = (next: MapPreferences) => {
    setPrefsState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <div className="stack" style={{ gap: "0.65rem" }}>
      <div className="field">
        <label htmlFor="mapBaseLayer">{t(locale, "map.layerBaseLabel")}</label>
        <select
          id="mapBaseLayer"
          value={prefs.baseLayerId}
          onChange={(e) => setPrefs({ ...prefs, baseLayerId: e.target.value as BaseLayerId })}
        >
          {TILE_LAYERS.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {t(locale, `map.layer.${layer.id}`)}
            </option>
          ))}
        </select>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={prefs.showTrails}
          onChange={(e) => setPrefs({ ...prefs, showTrails: e.target.checked })}
        />
        {t(locale, "map.layer.hikingTrails")}
      </label>
    </div>
  );
}
