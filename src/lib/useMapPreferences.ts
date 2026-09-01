"use client";

import { useEffect, useState } from "react";
import { TILE_LAYERS, type BaseLayerId } from "@/components/MapView";

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

/** Read global map layer prefs (Settings → localStorage). */
export function useMapPreferences(): MapPreferences {
  const [prefs, setPrefs] = useState<MapPreferences>(DEFAULTS);
  useEffect(() => {
    setPrefs(readStored());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return prefs;
}
