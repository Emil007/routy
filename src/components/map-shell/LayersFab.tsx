"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { useMapShell } from "./MapShellContext";

/**
 * Ebenen-Popover auf der Karte (§J5, optional klein): drei Karten-Basislayer plus
 * Waymarked-Overlay. Schreibt localStorage `routy.mapPreferences` — dasselbe
 * Format wie MapPreferencesForm → die eine Karte (MapCanvas via useMapPreferences)
 * aktualisiert sich sofort.
 */
export function LayersFab({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<{ baseLayerId: string; showTrails: boolean }>(() => {
    if (typeof window === "undefined") return { baseLayerId: "streets", showTrails: false };
    try {
      const parsed = JSON.parse(localStorage.getItem("routy.mapPreferences") ?? "{}") as Partial<{
        baseLayerId: string;
        showTrails: boolean;
      }>;
      return {
        baseLayerId: parsed.baseLayerId ?? "streets",
        showTrails: parsed.showTrails === true,
      };
    } catch {
      return { baseLayerId: "streets", showTrails: false };
    }
  });

  function write(next: { baseLayerId?: string; showTrails?: boolean }) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    localStorage.setItem("routy.mapPreferences", JSON.stringify(merged));
    // eigener Tab: StorageEvent feuert sonst nur in anderen Tabs → manuell verteilen.
    window.dispatchEvent(
      new StorageEvent("storage", { key: "routy.mapPreferences", newValue: JSON.stringify(merged) }),
    );
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="map-fab map-layers-fab"
        aria-label={t(locale, "shell.layers")}
        title={t(locale, "shell.layers")}
        onClick={() => setOpen((o) => !o)}
      >
        ▦
      </button>
      {open && (
        <div className="map-dialog layers-popover">
          <div className="field">
            {[
              { id: "streets", label: t(locale, "map.layer.streets") },
              { id: "hiking", label: t(locale, "map.layer.hiking") },
              { id: "satellite", label: t(locale, "map.layer.satellite") },
            ].map((layer) => (
              <label className="radio" key={layer.id}>
                <input
                  type="radio"
                  name="base-layer"
                  checked={prefs.baseLayerId === layer.id}
                  onChange={() => write({ baseLayerId: layer.id })}
                />
                {layer.label}
              </label>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={prefs.showTrails}
              onChange={(e) => write({ showTrails: e.target.checked })}
            />
            {t(locale, "map.layer.hikingTrails")}
          </label>
        </div>
      )}
    </>
  );
}
