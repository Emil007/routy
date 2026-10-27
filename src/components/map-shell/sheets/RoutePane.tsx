"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import type { MapLine } from "@/components/MapView";
import { RouteGenerator } from "@/components/RouteGenerator";
import { FreeRoamCard } from "@/components/FreeRoamCard";
import { useMapShell } from "../MapShellContext";

/**
 * Netzlinien für das freie Gehen (§7.4): dieselbe Ableitung wie RouteGenerator —
 * die eine Karte (MapCanvas) zeigt das Netz, FreeRoamCard meldet nur Track + Marker.
 */
function networkLinesFromBootstrap(bootstrap: AtlasBootstrap): MapLine[] {
  const lines: MapLine[] = [];
  for (const [segmentId, points] of Object.entries(bootstrap.segmentGeometries)) {
    if (!points || points.length < 2) continue;
    lines.push({ id: `seg-${segmentId}`, points });
  }
  return lines;
}

/**
 * RoutePane — EINE RouteGenerator-Instanz für Planen UND Gehen (§4.5 Mount-Regel:
 * gemountet bleiben, damit Must-visits nicht verloren gehen). Die section wird aus
 * Mode + aktiver Route abgeleitet:
 *  - plan → section="plan" (nur suggesting), Annehmen → onPhaseChange setzt GO.
 *  - go → section="go" (Active-Zweig, sofern Route aktiv; sonst hidden).
 *  - sonst hidden (RouteGenerator bleibt gemountet, unsichtbar).
 * Freies Gehen ist eine separate FreeRoamCard (hosted), sichtbar nur im GO ohne
 * aktive Route — Start ohne Stationsliste.
 */
export function RoutePane({ locale, bootstrap }: { locale: Locale; bootstrap: AtlasBootstrap }) {
  const { mode, setMode, registerLayers } = useMapShell();
  const [phase, setPhase] = useState<"suggesting" | "active">(
    bootstrap.activeRoute ? "active" : "suggesting",
  );
  const hasActiveRoute = Boolean(bootstrap.activeRoute);
  const networkLines = useMemo(() => networkLinesFromBootstrap(bootstrap), [bootstrap.segmentGeometries]);

  // Annehmen → Gehen (Dock-Chip), sobald die Route aktiv wird (§J3).
  useEffect(() => {
    if (phase === "active") setMode("go");
  }, [phase, setMode]);

  const section: "plan" | "go" | "hidden" =
    mode === "plan" ? "plan" : mode === "go" ? "go" : "hidden";

  // Aktive Route = Server-Zustand ODER client-seitig angenommen (phase === "active").
  // Go ohne aktive Route → RouteGenerator unsichtbar (Freies Gehen übernimmt).
  const routeActive = hasActiveRoute || phase === "active";
  const routeGeneratorSection: "plan" | "go" | "hidden" = routeActive
    ? section
    : section === "go"
      ? "hidden"
      : section;

  // Overlays der einen Route auf die eine Karte (PLAN/GO), §7.4 — das Netz bleibt
  // nur sichtbar, solange kein Overlay-Schreiber aktiv ist (siehe MapCanvas).
  useEffect(() => {
    if (mode !== "plan" && mode !== "go") {
      registerLayers(null);
    }
  }, [mode, registerLayers]);

  return (
    <div className="sheet-body">
      {/* Eine RouteGenerator-Instanz, immer gemountet (hidden via section). */}
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
        section={routeGeneratorSection}
        onPhaseChange={(next) => {
          setPhase(next);
          // Annehmen kippt auf Gehen, Verwerfen (ohne aktive Route) zurück auf Planen.
          if (next === "suggesting") setMode("plan");
        }}
        onLayersChange={(layers) => {
          if (mode === "plan" || mode === "go") registerLayers(layers);
        }}
      />

      {/* Freies Gehen: nur im Go-Modus ohne aktive Route, über der Karte. */}
      {!routeActive && mode === "go" && (
        <div className="free-roam-hosted">
          <FreeRoamCard locale={locale} nodes={bootstrap.nodes} networkLines={networkLines} hosted />
        </div>
      )}
    </div>
  );
}
