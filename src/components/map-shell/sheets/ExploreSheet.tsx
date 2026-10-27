"use client";

import { t, type Locale } from "@/lib/i18n";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import { useMapShell } from "../MapShellContext";

/**
 * Erkunden — Sheet-Inhalt der Karte (§7.4: Popups liegen in MapCanvas, weil das
 * Basisnetz hierher gehört). Web-Netz-Werkzeuge (Zeichnen/GPX/…) folgen in J4;
 * bewusste Lücke, Review-Notiz. Der Inhalt hält die Stufe lebend.
 */
export function ExploreSheet({ locale, bootstrap }: { locale: Locale; bootstrap: AtlasBootstrap }) {
  const { setStage } = useMapShell();
  return (
    <div className="sheet-body">
      <div className="btn-row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <span className="chip">{t(locale, "shell.editNetwork")}</span>
        <span className="chip" style={{ fontSize: "0.78rem", opacity: 0.7 }}>
          → J4
        </span>
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => setStage("peek")}
          title={t(locale, "shell.collapse")}
        >
          {t(locale, "shell.collapse")}
        </button>
      </div>
    </div>
  );
}
