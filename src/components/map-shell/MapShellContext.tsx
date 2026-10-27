"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AtlasMode, AtlasStage, ExploreTool } from "@/lib/atlasTypes";
import type { LiveSession } from "@/lib/mapMode";
import type { MapLayerSink } from "@/lib/mapLayerSink";

/** Art einer laufenden Live-Sitzung, die beim Moduswechsel bestätigt werden muss. */
export type LiveKind = "activeRoute" | "freeRoam" | "record";

interface PendingModeChange {
  to: AtlasMode;
  kind: LiveKind;
}

export interface MapShellState {
  mode: AtlasMode;
  stage: AtlasStage;
  tool: ExploreTool;
  profileOpen: boolean;
  /** Bearbeitete Segment-ID für das Werkzeug editShape (von SegmentPopup.onEditShape). */
  editSegmentId: number | null;
  /** Layer vom jeweiligen Karten-Schreiber (letzte Meldung gewinnt). */
  layers: MapLayerSink | null;
  setMode: (mode: AtlasMode) => void;
  setStage: (stage: AtlasStage) => void;
  setTool: (tool: ExploreTool) => void;
  setProfileOpen: (open: boolean) => void;
  setEditSegmentId: (id: number | null) => void;
  registerLayers: (layers: MapLayerSink | null) => void;
  /** Live-Sitzungen (aktive Route / Free-Roam / Aufnahme) für requestModeChange (§7.2). */
  liveSession: LiveSession;
  setLive: (kind: LiveKind, active: boolean) => void;
  /** Stopp-Handler der aktuell gemounteten Sheets — von requestModeChange bestätigte Wechsel rufen ihn. */
  registerLiveStop: (kind: LiveKind, stop: (() => void | Promise<void>) | null) => void;
  /** Anstehender, bestätigter Moduswechsel (Dialog in MapDock). */
  pendingChange: PendingModeChange | null;
  requestPendingChange: (change: PendingModeChange | null) => void;
  confirmPendingChange: () => Promise<void>;
}

const MapShellContext = createContext<MapShellState | null>(null);

export function MapShellProvider({ children, initialMode }: { children: ReactNode; initialMode: AtlasMode }) {
  const [mode, setMode] = useState<AtlasMode>(initialMode);
  const [stage, setStage] = useState<AtlasStage>("half");
  const [tool, setTool] = useState<ExploreTool>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<number | null>(null);
  const [layers, setLayers] = useState<MapLayerSink | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSession>({ kind: "none" });
  const [pendingChange, setPendingChange] = useState<PendingModeChange | null>(null);
  // Stopp-Handler in der Ref, damit sie vom bestätigenden Wechsel ohne stale closure gelesen werden.
  const stopsRef = useRef<Record<LiveKind, (() => void | Promise<void>) | null>>({
    activeRoute: null,
    freeRoam: null,
    record: null,
  });

  const registerLayers = useCallback((next: MapLayerSink | null) => setLayers(next), []);

  const setLive = useCallback((kind: LiveKind, active: boolean) => {
    setLiveSession((prev) => {
      if (active) return { kind };
      if (prev.kind === kind) return { kind: "none" };
      return prev;
    });
  }, []);

  const registerLiveStop = useCallback((kind: LiveKind, stop: (() => void | Promise<void>) | null) => {
    stopsRef.current[kind] = stop;
  }, []);

  const requestPendingChange = useCallback((change: PendingModeChange | null) => setPendingChange(change), []);

  const confirmPendingChange = useCallback(async () => {
    const pending = pendingChange;
    if (!pending) return;
    // Ziel-Modus zuerst setzen, dann die Sitzung beenden: so bleibt der bestätigte
    // Wechsel auch dann sichtbar, wenn der Stopp-Handler asynchron ist (trotzdem
    // pendingChange erst danach wegräumen — siehe RoutePane-Guard gegen plan-Sprung).
    const stop = stopsRef.current[pending.kind];
    setMode(pending.to);
    setStage("half");
    if (stop) await stop();
    setPendingChange(null);
  }, [pendingChange, setMode, setStage]);

  return (
    <MapShellContext.Provider
      value={{
        mode,
        stage,
        tool,
        profileOpen,
        editSegmentId,
        layers,
        setMode,
        setStage,
        setTool,
        setProfileOpen,
        setEditSegmentId,
        registerLayers,
        liveSession,
        setLive,
        registerLiveStop,
        pendingChange,
        requestPendingChange,
        confirmPendingChange,
      }}
    >
      {children}
    </MapShellContext.Provider>
  );
}

export function useMapShell(): MapShellState {
  const ctx = useContext(MapShellContext);
  if (!ctx) throw new Error("useMapShell must be used inside <MapShellProvider>");
  return ctx;
}
