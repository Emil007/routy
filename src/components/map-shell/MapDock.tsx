"use client";

import { t, type Locale } from "@/lib/i18n";
import { useMapShell } from "./MapShellContext";
import type { AtlasMode } from "@/lib/atlasTypes";

const DOCK_CHIPS: { mode: AtlasMode; key: "explore" | "plan" | "go" | "record"; disabled?: boolean }[] = [
  { mode: "explore", key: "explore" },
  { mode: "plan", key: "plan" },
  { mode: "go", key: "go", disabled: true },
  { mode: "record", key: "record", disabled: true },
];

/**
 * Dock als Label-Chips (Erkunden · Planen · Gehen · Aufnahme). Profil ist ein
 * runder Knopf oben, kein 5. Chip (W6). Darf auch bei laufender Wanderung/Aufnahme
 * sichtbar bleiben (W4). In J2 sind Gehen + Aufnahme noch disabled (`shell.comingNext`
 * nur als title, nicht als zweite Navigation — §J2 Abnahme-Parität).
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
      {DOCK_CHIPS.map(({ mode: m, key, disabled }) => (
        <button
          key={m}
          type="button"
          className={`map-dock-chip${mode === m ? " active" : ""}${disabled ? " disabled" : ""}`}
          onClick={() => !disabled && onChip(m)}
          aria-pressed={mode === m}
          title={disabled ? t(locale, "shell.comingNext") : undefined}
          disabled={disabled}
        >
          <span className="map-dock-chip-label">{t(locale, `shell.${key}`)}</span>
        </button>
      ))}
    </nav>
  );
}
