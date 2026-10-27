"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import type { MapLine } from "@/components/MapView";
import { MapShellProvider, useMapShell } from "./MapShellContext";
import { MapCanvas } from "./MapCanvas";
import { MapDock } from "./MapDock";
import { ProfileMenu } from "./ProfileMenu";
import { BottomSheet } from "./BottomSheet";
import { ExploreSheet } from "./sheets/ExploreSheet";
import { RoutePane } from "./sheets/RoutePane";
import { RecordSheet } from "./sheets/RecordSheet";

/** Netzlinien aus dem Bootstrap (für RecordSheet + FreeRoamCard), §7.4. */
function networkLinesFromBootstrap(bootstrap: AtlasBootstrap): MapLine[] {
  const lines: MapLine[] = [];
  for (const [segmentId, points] of Object.entries(bootstrap.segmentGeometries)) {
    if (!points || points.length < 2) continue;
    lines.push({ id: `seg-${segmentId}`, points });
  }
  return lines;
}

function ShellInner({
  locale,
  bootstrap,
  embedded,
}: {
  locale: Locale;
  bootstrap: AtlasBootstrap;
  embedded: boolean;
}) {
  const { mode } = useMapShell();
  const networkLines = useMemo(() => networkLinesFromBootstrap(bootstrap), [bootstrap.segmentGeometries]);

  return (
    <div className="atlas-shell">
      <MapCanvas locale={locale} bootstrap={bootstrap} />
      <MapDock locale={locale} />
      <ProfileMenu
        locale={locale}
        displayName={bootstrap.displayName}
        isAdmin={bootstrap.role === "admin"}
        embedded={embedded}
      />
      <BottomSheet locale={locale}>
        {/* §4.3 Mount-Regel: alle Sheets bleiben gemountet (hidden via CSS), damit
            RouteGenerator (Must-visits) einen Modus-Abstecher überlebt. */}
        <div className={mode === "explore" ? "sheet-pane" : "sheet-pane sheet-pane-hidden"}>
          <ExploreSheet locale={locale} bootstrap={bootstrap} />
        </div>
        <div className={mode === "plan" || mode === "go" ? "sheet-pane" : "sheet-pane sheet-pane-hidden"}>
          <RoutePane locale={locale} bootstrap={bootstrap} />
        </div>
        <div className={mode === "record" ? "sheet-pane" : "sheet-pane sheet-pane-hidden"}>
          <RecordSheet
            locale={locale}
            nodes={bootstrap.nodes}
            networkLines={networkLines}
            mergeRadiusM={bootstrap.mergeRadiusM}
            walkSpeedKmh={bootstrap.walkSpeedKmh}
          />
        </div>
      </BottomSheet>
    </div>
  );
}

export function MapShell({
  locale,
  bootstrap,
  embedded,
  initialMode,
}: {
  locale: Locale;
  bootstrap: AtlasBootstrap;
  embedded: boolean;
  initialMode: "explore" | "plan" | "go" | "record";
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <MapShellProvider initialMode={initialMode}>
      <ShellInner locale={locale} bootstrap={bootstrap} embedded={embedded} />
    </MapShellProvider>
  );
}
