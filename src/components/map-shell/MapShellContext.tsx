"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { AtlasMode, AtlasStage, ExploreTool } from "@/lib/atlasTypes";
import type { MapLayerSink } from "@/lib/mapLayerSink";

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
}

const MapShellContext = createContext<MapShellState | null>(null);

export function MapShellProvider({ children, initialMode }: { children: ReactNode; initialMode: AtlasMode }) {
  const [mode, setMode] = useState<AtlasMode>(initialMode);
  const [stage, setStage] = useState<AtlasStage>("half");
  const [tool, setTool] = useState<ExploreTool>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<number | null>(null);
  const [layers, setLayers] = useState<MapLayerSink | null>(null);

  const registerLayers = useCallback((next: MapLayerSink | null) => setLayers(next), []);

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
