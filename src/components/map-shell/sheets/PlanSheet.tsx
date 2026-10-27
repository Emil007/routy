"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { RouteGenerator } from "@/components/RouteGenerator";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import { useMapShell } from "../MapShellContext";

/**
 * Planen: hostet RouteGenerator im hosted-Modus (§4.5). Der suggesting-Zweig lenkt
 * dorthin; eine akzeptierte Route liegt in J2 noch hier (der Gehen-Modus kommt in J3).
 * RouteGenerator bleibt gemountet (hidden), damit Must-visits überleben.
 */
export function PlanSheet({ locale, bootstrap }: { locale: Locale; bootstrap: AtlasBootstrap }) {
  const { mode, registerLayers, setMode } = useMapShell();
  const [phase, setPhase] = useState<"suggesting" | "active">(
    bootstrap.activeRoute ? "active" : "suggesting",
  );

  // Dock = Planen, sobald die aktive Route (noch) hier lebt; in J3 wandert sie nach Gehen.
  useEffect(() => {
    if (mode === "plan" && phase === "active") {
      // In J2 liegt die aktive Route noch im Plan-Sheet (§J2). Nichts weiter zu tun.
    }
  }, [mode, phase]);

  const section = mode === "plan" ? "plan" : "hidden";

  return (
    <div className="sheet-body">
      <RouteGenerator
        locale={locale}
        nodes={bootstrap.nodes}
        homeNodeId={bootstrap.homeNodeId}
        initialActiveRoute={bootstrap.activeRoute}
        initialNickname={bootstrap.activeNickname}
        favorites={bootstrap.favorites}
        segmentGeometries={bootstrap.segmentGeometries}
        canonicalSegmentIds={bootstrap.canonicalSegmentIds}
        segmentNames={bootstrap.segmentNames}
        initialUsingNetworkFallback={bootstrap.usingNetworkFallback}
        disconnectedSegmentIds={bootstrap.disconnectedSegmentIds}
        isAdmin={bootstrap.role === "admin"}
        hosted
        section={section}
        onPhaseChange={setPhase}
        onLayersChange={(layers) => {
          if (mode === "plan") registerLayers(layers);
        }}
      />
    </div>
  );
}
