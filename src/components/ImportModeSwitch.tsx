"use client";

import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { GpxImportWizard } from "./GpxImportWizard";
import { DrawPathWizard } from "./DrawPathWizard";
import type { NodeRow } from "@/lib/nodes";
import type { MapLine } from "./MapView";

export function ImportModeSwitch({
  locale,
  nodes,
  networkLines,
  mergeRadiusM,
  walkSpeedKmh,
}: {
  locale: Locale;
  nodes: NodeRow[];
  networkLines: MapLine[];
  mergeRadiusM: number;
  walkSpeedKmh: number;
}) {
  const [mode, setMode] = useState<"upload" | "draw">("upload");

  return (
    <div className="stack">
      <div className="btn-row">
        <button type="button" className={mode === "upload" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("upload")}>
          {t(locale, "import.uploadMode")}
        </button>
        <button type="button" className={mode === "draw" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("draw")}>
          {t(locale, "import.drawMode")}
        </button>
      </div>

      {mode === "upload" ? (
        <GpxImportWizard locale={locale} />
      ) : (
        <DrawPathWizard
          locale={locale}
          nodes={nodes}
          networkLines={networkLines}
          mergeRadiusM={mergeRadiusM}
          walkSpeedKmh={walkSpeedKmh}
        />
      )}
    </div>
  );
}
