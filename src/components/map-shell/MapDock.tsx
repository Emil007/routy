"use client";

import { t, type Locale } from "@/lib/i18n";
import { useMapShell } from "./MapShellContext";
import type { AtlasMode } from "@/lib/atlasTypes";

const DOCK_CHIPS: { mode: AtlasMode; key: "explore" | "plan" | "go" | "record" }[] = [
  { mode: "explore", key: "explore" },
  { mode: "plan", key: "plan" },
  { mode: "go", key: "go" },
  { mode: "record", key: "record" },
];

/**
 * Dock als Label-Chips (Erkunden · Planen · Gehen · Aufnahme). Profil ist ein
 * runder Knopf oben, kein 5. Chip (W6). Darf auch bei laufender Wanderung/Aufnahme
 * sichtbar bleiben (W4). J4: Aufnahme ist ein vollwertiger Modus (RecordSheet).
 */
export function MapDock({ locale }: { locale: Locale }) {
  const { mode, setMode, stage, setStage } = useMapShell();

  function onChip(next: AtlasMode) {
    setMode(next);
    // Tipp auf den aktiven Modus toggelt half ↔ peek (§7.2), sonst half.
    setStage(mode === next && stage === "half" ? "peek" : "half");
  }

  return (
    <nav className="map-dock">
      {DOCK_CHIPS.map(({ mode: m, key }) => (
        <button
          key={m}
          type="button"
          className={`map-dock-chip${mode === m ? " active" : ""}`}
          onClick={() => onChip(m)}
          aria-pressed={mode === m}
        >
          <span className="map-dock-chip-label">{t(locale, `shell.${key}`)}</span>
        </button>
      ))}
    </nav>
  );
}
