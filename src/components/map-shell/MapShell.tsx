"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import { MapShellProvider, useMapShell } from "./MapShellContext";
import { MapCanvas } from "./MapCanvas";
import { MapDock } from "./MapDock";
import { ProfileMenu } from "./ProfileMenu";
import { BottomSheet } from "./BottomSheet";
import { ExploreSheet } from "./sheets/ExploreSheet";
import { PlanSheet } from "./sheets/PlanSheet";

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
          <PlanSheet locale={locale} bootstrap={bootstrap} />
        </div>
        <div className="sheet-pane sheet-pane-hidden">
          <div className="sheet-body">{t(locale, "shell.comingNext")}</div>
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
