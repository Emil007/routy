"use client";

import { useMemo } from "react";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "@/components/MapViewLazy";
import { NodePopup } from "@/components/NodePopup";
import { SegmentPopup } from "@/components/SegmentPopup";
import type { MapLine, MapMarker } from "@/components/MapView";
import { mapAccentHex } from "@/lib/mapAccent";
import { useMapPreferences } from "@/lib/useMapPreferences";
import { useMapShell } from "./MapShellContext";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import { canEdit } from "@/lib/ownership";
import { isLocked } from "@/lib/segmentLock";

/**
 * Die eine Karte der Hülle (§7.4). Basisnetz gehört hierher: prominent + mit Popups
 * im Erkunden, dünn sobald ein Overlay-Schreiber (Plan/Go/Record/Werkzeug) eine
 * Meldung über registerLayers abgegeben hat. Genau ein Schreiber gewinnt.
 */
export function MapCanvas({ locale, bootstrap }: { locale: Locale; bootstrap: AtlasBootstrap }) {
  const mapPrefs = useMapPreferences();
  const { mode, layers, setEditSegmentId, setTool } = useMapShell();
  // §6: Akzent aus dem Theme (hell #2e6b49 / dunkel #6fc08c / kontrast/dog/cat) —
  // eine Quelle für Netz und Route, Parität mit Android.
  const accentHex = mapAccentHex(
    typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined,
    typeof window !== "undefined" && window.matchMedia?.(`(prefers-color-scheme: dark)`).matches,
  );

  const writerActive = (layers?.lines?.length ?? 0) > 0 || (layers?.markers?.length ?? 0) > 0;
  const explore = mode === "explore" && !writerActive;

  const nodesById = useMemo(() => new Map(bootstrap.nodes.map((n) => [n.id, n])), [bootstrap.nodes]);
  const goldenSet = useMemo(() => new Set(bootstrap.goldenSegmentIds), [bootstrap.goldenSegmentIds]);
  const disconnectedSet = useMemo(() => new Set(bootstrap.disconnectedSegmentIds), [bootstrap.disconnectedSegmentIds]);
  const conditionsBySegment = useMemo(() => {
    const m = new Map<number, { id: number; reason: string; expiresAt: string }[]>();
    for (const c of bootstrap.segmentConditions) {
      const l = m.get(c.segmentId) ?? [];
      l.push(c);
      m.set(c.segmentId, l);
    }
    return m;
  }, [bootstrap.segmentConditions]);
  const currentUser = useMemo(() => ({ id: bootstrap.userId, role: bootstrap.role }), [bootstrap.userId, bootstrap.role]);
  const currentUserId = bootstrap.userId;

  function creatorName(id: number | null): string {
    return id !== null ? (bootstrap.userNames[id] ?? `#${id}`) : "–";
  }

  const baseLines: MapLine[] = useMemo(
    () =>
      bootstrap.segments.map((s) => {
        const golden = goldenSet.has(s.id);
        const disconnected = disconnectedSet.has(s.id);
        return {
          id: s.id,
          points: s.geometry.map((p): [number, number] => [p.lat, p.lng]),
          // Kräftige, immer erkennbare Wege-Farben (User-Feedback 0.57): kein
          // blasses, erfundenes Grau (#5a7d6c war ein Paritätsbruch — kein Token).
          // Schreiber-aktiv: Netz dünn im AKZENT (Android-Modell: beides Akzent,
          // nur die Route kommt dicker). Erkunden: volle Dicke.
          color: disconnected ? "#c53030" : golden ? "#c99a2e" : writerActive ? accentHex : undefined,
          weight: writerActive ? 2.5 : golden || disconnected ? 6 : 4,
          dashed: golden || isLocked(s) || disconnected,
          popup:
            explore && !writerActive ? (
              <SegmentPopup
                locale={locale}
                segment={s}
                startName={nodesById.get(s.startNodeId)?.name || `#${s.startNodeId}`}
                endName={nodesById.get(s.endNodeId)?.name || `#${s.endNodeId}`}
                canEditSegment={canEdit(currentUser, s.submittedBy)}
                creatorName={creatorName(s.submittedBy)}
                usageCount={bootstrap.usage[s.id] ?? 0}
                activeConditions={conditionsBySegment.get(s.id)}
                personalAvoided={bootstrap.personalAvoidSegmentIds.includes(s.id)}
                onEditShape={() => {
                  // J7: Form-Bearbeitung öffnet das Werkzeug als Tool-Panel der Hülle
                  // (Edit-Shape aus SegmentPopup, §J4); Split bleibt im Editor selbst.
                  setEditSegmentId(s.id);
                  setTool("editShape");
                }}
              />
            ) : undefined,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bootstrap.segments, locale, nodesById, goldenSet, disconnectedSet, explore, writerActive, accentHex],
  );

  const baseMarkers: MapMarker[] = useMemo(
    () =>
      bootstrap.nodes.map((n) => ({
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        label: n.name || t(locale, "map.unnamedNode"),
        color: n.id === bootstrap.homeNodeId ? "#a5711c" : "#2e6b49",
        popup:
          explore && !writerActive ? (
            <NodePopup
              locale={locale}
              node={n}
              isUserHome={n.id === bootstrap.homeNodeId}
              canEditNode={canEdit(currentUser, n.createdBy)}
              creatorName={creatorName(n.createdBy)}
              segmentCount={bootstrap.usage[n.id] ?? 0}
              moveModeActive={false}
              onToggleMove={() => {}}
            />
          ) : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bootstrap.nodes, locale, explore, writerActive, bootstrap.homeNodeId],
  );

  const fitKey = layers?.fitKey;

  return (
    <div className="atlas-map-fill" style={{ position: "absolute", inset: 0 }}>
      <MapViewLazy
        fill
        markers={[...baseMarkers, ...(layers?.markers ?? [])]}
        lines={[...baseLines, ...(layers?.lines ?? [])]}
        circles={layers?.circles}
        fitKey={fitKey}
        onMarkerClick={layers?.onMarkerClick}
        onMarkerDragEnd={layers?.onMarkerDragEnd}
        onLineClick={layers?.onLineClick}
        onMapClick={layers?.onMapClick}
        baseLayerId={mapPrefs.baseLayerId}
        showTrails={mapPrefs.showTrails}
        zoomControlPosition="topleft"
      />
    </div>
  );
}
