"use client";

import { t, type Locale } from "@/lib/i18n";
import { useMapShell, type LiveKind } from "./MapShellContext";
import { requestModeChange, type ModeChangeResult } from "@/lib/mapMode";
import type { AtlasMode } from "@/lib/atlasTypes";

const PENDING_LIVE_KIND: Record<string, LiveKind> = {
  "stop-route": "activeRoute",
  "stop-roam": "freeRoam",
  "stop-record": "record",
};

const DOCK_CHIPS: { mode: AtlasMode; key: "explore" | "plan" | "go" | "record" }[] = [
  { mode: "explore", key: "explore" },
  { mode: "plan", key: "plan" },
  { mode: "go", key: "go" },
  { mode: "record", key: "record" },
];

const PENDING_I18N: Record<LiveKind, { titleKey: string; bodyKey: string }> = {
  activeRoute: { titleKey: "shell.leaveActiveRoute", bodyKey: "shell.leaveActiveRouteBody" },
  freeRoam: { titleKey: "shell.leaveFreeRoam", bodyKey: "shell.leaveFreeRoamBody" },
  record: { titleKey: "shell.leaveRecording", bodyKey: "shell.leaveRecordingBody" },
};

/**
 * Dock als Label-Chips (Erkunden · Planen · Gehen · Aufnahme). Profil ist ein
 * runder Knopf oben, kein 5. Chip (W6). Darf auch bei laufender Wanderung/Aufnahme
 * sichtbar bleiben (W4). J4: Aufnahme ist ein vollwertiger Modus (RecordSheet).
 *
 * §7.2: Ein Moduswechsel durch requestModeChange — eine laufende Live-Sitzung
 * (aktive Route / freies Gehen / Aufnahme) verlangt vor dem Wechsel Bestätigung
 * und beendet die Sitzung über den registrierten Stopp-Pfad (Watch aus, Discard).
 */
export function MapDock({ locale }: { locale: Locale }) {
  const { mode, stage, setMode, setStage, liveSession, pendingChange, requestPendingChange, confirmPendingChange } =
    useMapShell();

  function onChip(next: AtlasMode) {
    // Web: Aufnahme/Route im Hintergrund weiterführen gibt es nicht (§J4) — ein
    // Verlassen beendet die Sitzung, wenn eine läuft. (Android hält den Hintergrund-
    // Dienst; Web stoppt.)
    const result: ModeChangeResult = requestModeChange(mode, next, liveSession, /* recordContinuesInBackground */ false);
    if (result.allow) {
      applySwitch(next);
    } else {
      const kind = PENDING_LIVE_KIND[result.confirm];
      if (kind) requestPendingChange({ to: next, kind });
    }
  }

  function applySwitch(next: AtlasMode) {
    setMode(next);
    // Tipp auf den aktiven Modus toggelt half ↔ peek (§7.2), sonst half.
    setStage(mode === next && stage === "half" ? "peek" : "half");
    requestPendingChange(null);
  }

  const pending = pendingChange
    ? {
        ...pendingChange,
        ...PENDING_I18N[pendingChange.kind],
      }
    : null;

  return (
    <>
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

      {pending && (
        <div className="map-dialog dock-confirm" role="alertdialog" aria-live="assertive">
          <strong>{t(locale, pending.titleKey)}</strong>
          <p className="hint-compact" style={{ margin: "0.35rem 0 0 0" }}>
            {t(locale, pending.bodyKey)}
          </p>
          <div className="btn-row" style={{ marginTop: "0.6rem" }}>
            <button type="button" className="btn-secondary btn-compact" onClick={() => requestPendingChange(null)}>
              {t(locale, "common.cancel")}
            </button>
            <button type="button" className="btn-danger btn-compact" onClick={() => void confirmPendingChange()}>
              {t(locale, "common.confirm")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
