"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { haversineMeters, bearing, compassDirection } from "@/lib/geo";
import { playRoutySound } from "@/lib/sounds";
import {
  formatStationLabel,
  stationSpeakName,
  voiceAnnounceRadiusM,
} from "@/lib/voiceAnnounce";
import type { MapLayerSink } from "@/lib/mapLayerSink";
import { RouteCompletionDialog, type RouteCompletionData } from "./RouteCompletionDialog";
import { type MapLine, type MapMarker } from "./MapView";
import type { NodeRow } from "@/lib/nodes";
import { mapAccentHex } from "@/lib/mapAccent";
import type { RouteDisplay } from "@/lib/routeDisplay";

interface GenerateResponse {
  token: string;
  route: RouteDisplay;
  pointPreview?: { base: number; golden: number; exploration: number; diversity: number; total: number };
  goldenHits?: number;
  goldenHitIds?: number[];
  lengthRelaxed?: boolean;
  lengthKm?: number;
  usingNetworkFallback?: boolean;
  closedNodeWarnings?: number[];
  guideMode?: boolean;
  pointsMultiplier?: number;
}

interface FavoriteEntry {
  id: number;
  name: string;
  shareToken: string | null;
  display: RouteDisplay;
}

type LengthPreset = "short" | "normal" | "long" | "surprise";

/**
 * Unified restrict vocabulary (0.46 F5): segment constraints here use the same
 * labels as map SegmentPopup — Required / Excluded / Clear.
 */

const PRESET_LABEL_KEYS: Record<LengthPreset, string> = {
  short: "route.presetShortBtn",
  normal: "route.presetNormalBtn",
  long: "route.presetLongBtn",
  surprise: "route.presetSurprise",
};

const PRESET_HINT_KEYS: Record<LengthPreset, string> = {
  short: "route.presetShortHint",
  normal: "route.presetNormalHint",
  long: "route.presetLongHint",
  surprise: "route.presetSurpriseHint",
};

export interface RouteGeneratorHandle {
  /** Aktive Route über den bestehenden Discard-Pfad beenden (Watch aus). */
  discardActive: (opts?: { skipConfirm?: boolean }) => Promise<void>;
  /** M3-3: Dock-Stop — laufende Route löschen, auf der Zwischenseite (adopted) nur
   *  lokal de-adoptieren (Vorschlag + Token bleiben, Q1). */
  stopLive: () => Promise<void>;
}

export function RouteGenerator({
  locale,
  nodes,
  homeNodeId,
  initialActiveRoute,
  initialNickname,
  favorites: initialFavorites,
  segmentGeometries,
  canonicalSegmentIds,
  segmentNames,
  initialUsingNetworkFallback,
  disconnectedSegmentIds = [],
  isAdmin = false,
  section = "plan",
  onLayersChange,
  onPhaseChange,
  onAdoptedChange,
  ref,
}: {
  ref?: Ref<RouteGeneratorHandle>;
  locale: Locale;
  nodes: NodeRow[];
  homeNodeId: number | null;
  initialActiveRoute: RouteDisplay | null;
  initialNickname: string | null;
  favorites: FavoriteEntry[];
  segmentGeometries: Record<number, [number, number][]>;
  canonicalSegmentIds: number[];
  segmentNames: Record<number, string | null>;
  initialUsingNetworkFallback: boolean;
  disconnectedSegmentIds?: number[];
  isAdmin?: boolean;
  /** Welcher Teil gerendert wird: hidden → nichts, go ohne aktive Route → nichts. */
  section?: "plan" | "go" | "hidden";
  /** M6: null = Section unsichtbar → Layer abräumen. */
  onLayersChange?: (layers: MapLayerSink | null) => void;
  /** Annehmen → "active", Verwerfen/Abbrechen → "suggesting" (§4.5, ab J3 Dock-Switch). */
  onPhaseChange?: (phase: "suggesting" | "active") => void;
  /** Meldet den lokalen „Auswählen"-Zustand (adopted) nach oben, damit RoutePane
   *  die Route als aktiv führt (Frei-Wechsel verlangt Bestätigung, Go bleibt
   *  sichtbar) — Parität mit Android select(). */
  onAdoptedChange?: (adopted: boolean) => void;
}) {
  const router = useRouter();
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // §6: Akzent-Farbe der Karte deterministisch aus dem HTML data-theme (auto → prefers-color-scheme).
  const accentHex = useMemo(
    () =>
      mapAccentHex(
        typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined,
        typeof window !== "undefined" && window.matchMedia?.(`(prefers-color-scheme: dark)`).matches,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [deletedFavoriteIds, setDeletedFavoriteIds] = useState<Set<number>>(() => new Set());
  const favorites = useMemo(
    () => initialFavorites.filter((f) => !deletedFavoriteIds.has(f.id)),
    [initialFavorites, deletedFavoriteIds],
  );
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const disconnectedSet = useMemo(() => new Set(disconnectedSegmentIds), [disconnectedSegmentIds]);
  const [lengthPreset, setLengthPreset] = useState<LengthPreset>("short");

  const [startNodeId, setStartNodeId] = useState<number | "">(homeNodeId ?? "");
  const [isLoop, setIsLoop] = useState(true);
  const [endNodeId, setEndNodeId] = useState<number | "">(homeNodeId ?? "");
  const [pendingDestinationReplace, setPendingDestinationReplace] = useState<number | null>(null);
  const [mustVisitNodeIds, setMustVisitNodeIds] = useState<number[]>([]);
  const [requiredSegmentIds, setRequiredSegmentIds] = useState<number[]>([]);
  const [excludedSegmentIds, setExcludedSegmentIds] = useState<number[]>([]);
  const [explorerMode, setExplorerMode] = useState(false);
  const [forceGolden, setForceGolden] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);

  const [mode, setMode] = useState<"suggesting" | "active">("suggesting");
  // Parität mit Android: „Auswählen“ übernimmt die Route nur lokal (kein Server-
  // accept, Token bleibt). Erst „Go“ ruft /api/route/accept und startet das
  // Tracking — der Dock wechselt nicht vorher auf Gehen/Frei. Der Wert wird via
  // onAdoptedChange an RoutePane gemeldet (routeActive/Frei-Bestätigung).
  // initialActiveRoute (am Account gespeicherte Route beim Öffnen) landet wie ein
  // Favorit auf der Zwischenseite (adopted): gezeichnet, Go+Ansage, noch kein Start.
  const [adopted, setAdoptedState] = useState(Boolean(initialActiveRoute));
  const setAdopted = useCallback(
    (next: boolean) => {
      setAdoptedState(next);
      onAdoptedChange?.(next);
    },
    [onAdoptedChange],
  );
  const [result, setResult] = useState<GenerateResponse | null>(
    initialActiveRoute ? { token: "", route: initialActiveRoute } : null,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "saving">("idle");

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [pointBalance, setPointBalance] = useState<number | null>(null);
  const [dailyChallenge, setDailyChallenge] = useState<string | null>(null);
  const [goldenSegmentIds, setGoldenSegmentIds] = useState<number[]>([]);
  const [completionData, setCompletionData] = useState<RouteCompletionData | null>(null);
  const [usingNetworkFallback, setUsingNetworkFallback] = useState<boolean | null>(initialUsingNetworkFallback);
  const [repositionCandidates, setRepositionCandidates] = useState<number[] | null>(null);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number>(35);
  const announcedStationIndexRef = useRef(0);
  const waitingToLeaveIndexRef = useRef<number | null>(null);
  // M4: GPS-Walk-Puffer + Startzeit für den Complete-Body (trackPoints, durationMin).
  const trackBufferRef = useRef<{ lat: number; lng: number; accuracy?: number; time: string }[]>([]);
  const walkStartedAtRef = useRef<number | null>(null);
  const followEnabled = watchId !== null;

  const requiredSet = useMemo(() => new Set(requiredSegmentIds), [requiredSegmentIds]);
  const excludedSet = useMemo(() => new Set(excludedSegmentIds), [excludedSegmentIds]);
  const goldenSet = useMemo(() => new Set(goldenSegmentIds), [goldenSegmentIds]);

  function segmentLabel(segmentId: number): string {
    const name = segmentNames[segmentId];
    if (name?.trim()) return name;
    return t(locale, "map.proposalSegment", { id: segmentId });
  }

  function nodeLabel(id: number | ""): string {
    if (!id) return "…";
    const n = nodesById.get(id);
    const name = n?.name || `#${id}`;
    return id === homeNodeId ? `${name} (${t(locale, "map.home")})` : name;
  }

  function flashMessage(text: string, isError = false) {
    setMessage(text);
    setMessageIsError(isError);
  }

  function clearMessage() {
    setMessage(null);
    setMessageIsError(false);
  }

  function clearNodeRole(nodeId: number) {
    if (startNodeId === nodeId) setStartNodeId(homeNodeId ?? "");
    if (endNodeId === nodeId) setEndNodeId(homeNodeId ?? "");
    setMustVisitNodeIds((prev) => prev.filter((id) => id !== nodeId));
  }

  function setNodeAsStart(nodeId: number) {
    clearNodeRole(nodeId);
    setStartNodeId(nodeId);
    if (isLoop) setEndNodeId(nodeId);
    setSelectedNodeId(null);
  }

  /**
   * Ziel setzen — immer verfügbar (unabhängig von Rundweg).
   * Ist schon ein Ziel gesetzt, fragt ein Dialog nach, ob es für diese
   * Berechnung gewechselt werden soll (Parität mit der App).
   */
  function setNodeAsEnd(nodeId: number) {
    const existing = endNodeId;
    if (existing !== "" && existing !== nodeId) {
      // M3-5: beim Wechsel-Vorschlag noch KEINE Rolle räumen — solange der Dialog
      // offen ist, bleiben Start und Muss-besucht des Knotens stehen. Erst der
      // Bestätigen-Button räumt; Abbrechen behält alles.
      setPendingDestinationReplace(nodeId);
      setSelectedNodeId(null);
      return;
    }
    clearNodeRole(nodeId);
    setEndNodeId(nodeId);
    setIsLoop(false);
    setSelectedNodeId(null);
  }

  function confirmReplaceDestination() {
    const nodeId = pendingDestinationReplace;
    if (nodeId === null) return;
    clearNodeRole(nodeId);
    setEndNodeId(nodeId);
    setIsLoop(false);
    setPendingDestinationReplace(null);
    setSelectedNodeId(null);
  }

  function dismissReplaceDestination() {
    setPendingDestinationReplace(null);
  }

  /** Löscht alle Planungs-Markierungen (Ziel, Muss-besucht, Pflicht/Ausschluss), behält Start/Home. */
  function resetPlanning() {
    setIsLoop(true);
    setEndNodeId(homeNodeId ?? "");
    setMustVisitNodeIds([]);
    setRequiredSegmentIds([]);
    setExcludedSegmentIds([]);
    setSelectedNodeId(null);
    setSelectedSegmentId(null);
    setPendingDestinationReplace(null);
  }

  function toggleMustVisit(nodeId: number) {
    if (mustVisitNodeIds.includes(nodeId)) {
      setMustVisitNodeIds((prev) => prev.filter((id) => id !== nodeId));
    } else {
      if (startNodeId === nodeId) setStartNodeId(homeNodeId ?? "");
      // Parität mit der App: Ein Knoten kann nicht gleichzeitig Ziel und
      // Muss-besucht sein — das Ziel weicht.
      if (endNodeId === nodeId) {
        setIsLoop(true);
        setEndNodeId(homeNodeId ?? "");
      }
      setMustVisitNodeIds((prev) => [...prev, nodeId]);
    }
    setSelectedNodeId(null);
  }

  function setSegmentRequired(segmentId: number) {
    setExcludedSegmentIds((prev) => prev.filter((id) => id !== segmentId));
    setRequiredSegmentIds((prev) => (prev.includes(segmentId) ? prev : [...prev, segmentId]));
    setSelectedSegmentId(null);
  }

  function setSegmentExcluded(segmentId: number) {
    setRequiredSegmentIds((prev) => prev.filter((id) => id !== segmentId));
    setExcludedSegmentIds((prev) => (prev.includes(segmentId) ? prev : [...prev, segmentId]));
    setSelectedSegmentId(null);
  }

  function clearSegmentConstraint(segmentId: number) {
    setRequiredSegmentIds((prev) => prev.filter((id) => id !== segmentId));
    setExcludedSegmentIds((prev) => prev.filter((id) => id !== segmentId));
    setSelectedSegmentId(null);
  }

  const routeMapLines = useMemo(() => {
    if (!result) return [];
    // §2.2/§6 + 0.57: Die Route muss im Plan/Go-Modus KLAR vom Hintergrund-Netz
    // abheben. Das Netz nutzt jetzt die Akzentfarbe — die Route bekommt ein
    // kräftiges, kontrastreiches Blau mit dicker Linie (in jedem Theme sichtbar).
    // M1-16: RouteDisplay.geometry arrives as { lat, lng }[] — MapLine wants [lat, lng].
    const points = result.route.geometry.map((p) => [p.lat, p.lng] as [number, number]);
    const lines: MapLine[] = [{ id: "route", points, color: "#2563eb", weight: 7 }];
    const hitIds = new Set(
      result.goldenHitIds ?? result.route.segmentIds.filter((id) => goldenSet.has(id)),
    );
    for (const segmentId of hitIds) {
      const points = segmentGeometries[segmentId];
      if (!points?.length) continue;
      lines.push({
        id: `golden-${segmentId}`,
        points,
        color: "#c99a2e",
        dashed: true,
        weight: 7,
      });
    }
    return lines;
  }, [result, goldenSet, segmentGeometries, accentHex]);

  const networkMapLines = useMemo((): MapLine[] => {
    if (mode !== "suggesting" || result) return [];
    const lines: MapLine[] = [];
    for (const segmentId of canonicalSegmentIds) {
      const points = segmentGeometries[segmentId];
      if (!points?.length) continue;
      const isRequired = requiredSet.has(segmentId);
      const isExcluded = excludedSet.has(segmentId);
      const isGolden = goldenSet.has(segmentId);
      const isDisconnected = disconnectedSet.has(segmentId);
      lines.push({
        id: segmentId,
        points,
        color: isDisconnected ? "#e05a45" : isExcluded ? "#e05a45" : isRequired ? "#2b6cb0" : isGolden ? "#c99a2e" : accentHex,
        weight: isRequired || isGolden || isDisconnected ? 6 : 4,
        dashed: isExcluded || isGolden || isDisconnected,
      });
    }
    return lines;
  }, [mode, result, canonicalSegmentIds, segmentGeometries, requiredSet, excludedSet, goldenSet, disconnectedSet]);

  const planningMarkers = useMemo((): MapMarker[] => {
    if (mode !== "suggesting" || result) return [];
    return nodes.map((n) => {
      let badge: string | undefined;
      let color = "#2e6b49";
      if (n.id === startNodeId) {
        badge = t(locale, "route.badgeStart");
        color = "#a5711c";
      } else if (!isLoop && n.id === endNodeId) {
        badge = t(locale, "route.badgeTarget");
        color = "#7c3aed";
      } else {
        const mustIdx = mustVisitNodeIds.indexOf(n.id);
        if (mustIdx >= 0) {
          badge = mustVisitNodeIds.length > 1 ? String(mustIdx + 1) : t(locale, "route.badgeMustVisit");
          color = "#2b6cb0";
        }
      }
      return {
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        label: n.name || `#${n.id}`,
        color,
        badge,
      };
    });
  }, [mode, result, nodes, startNodeId, endNodeId, isLoop, mustVisitNodeIds, locale]);

  const mapLines = result ? routeMapLines : networkMapLines;
  const mapMarkers: MapMarker[] = result
    ? [
        ...result.route.stations.map((s, idx) => ({
          id: `${s.nodeId}-${idx}`,
          lat: s.lat,
          lng: s.lng,
          label: s.name || `#${s.nodeId}`,
          color: idx === 0 ? "#a5711c" : "#2e6b49",
        })),
        ...(myLocation
          ? [{ id: "me", lat: myLocation.lat, lng: myLocation.lng, label: t(locale, "route.you"), color: "#2b6cb0" }]
          : []),
      ]
    : planningMarkers;

  const mapFitKey = result
    ? result.token || result.route.nodeChain.join("-")
    : `plan-${startNodeId}-${endNodeId}-${mustVisitNodeIds.join(",")}-${requiredSegmentIds.join(",")}`;

  function handleMarkerClick(id: number | string) {
    if (mode !== "suggesting" || result) return;
    setSelectedSegmentId(null);
    setSelectedNodeId(Number(id));
  }

  function handleLineClick(id: number | string) {
    if (mode !== "suggesting" || result) return;
    setSelectedNodeId(null);
    setSelectedSegmentId(Number(id));
  }

  // §4.5/M6-1: Layer nach oben melden — MapCanvas zeichnet die eine Karte, RouteGenerator
  // liefert nur das Overlay (Route/Plan-Marker). NUR wenn diese Section sichtbar ist
  // (plan/go); Cleanup räumt die Layer, damit hidden/reocrd/explore nicht das Overlay
  // einer unsichtbaren Route zeichnet.
  useEffect(() => {
    if (!onLayersChange || (section !== "plan" && section !== "go")) {
      onLayersChange?.(null);
      return;
    }
    onLayersChange({
      markers: mapMarkers,
      lines: mapLines,
      fitKey: mapFitKey,
      onMarkerClick: mode === "suggesting" && !result ? handleMarkerClick : undefined,
      onLineClick: mode === "suggesting" && !result ? handleLineClick : undefined,
    });
    return () => onLayersChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMarkers, mapLines, mapFitKey, mode, result, section]);

  async function readApiError(res: Response): Promise<string> {
    const data = (await res.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null;
    if (res.status === 429 && data?.error === "rate_limited") {
      return t(locale, "route.rateLimited", { seconds: data.retryAfterSeconds ?? 60 });
    }
    if (data?.error === "no_home_node") return t(locale, "route.noHomeNode");
    if (data?.error === "no_golden_route") return t(locale, "route.noGoldenRoute");
    if (data?.error === "constraints_impossible") return t(locale, "route.constraintsImpossible");
    if (data?.error === "unreachable_guide_leg") return t(locale, "route.unreachableGuideLeg");
    return t(locale, "route.noRouteFound");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/app/game/daily");
      if (!cancelled && res.ok) {
        const data = (await res.json()) as {
          pointBalance: number;
          dailyChallenge?: string | null;
          goldenSegments: { segmentId: number }[];
        };
        setPointBalance(data.pointBalance);
        if (data.dailyChallenge) setDailyChallenge(data.dailyChallenge);
        setGoldenSegmentIds(data.goldenSegments.map((g) => g.segmentId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voiceEnabled || mode !== "active" || !myLocation || !result) return;
    const stations = result.route.stations;

    const waitingIdx = waitingToLeaveIndexRef.current;
    if (waitingIdx !== null) {
      const leftStation = stations[waitingIdx];
      const leftRadius = voiceAnnounceRadiusM(waitingIdx, stations);
      if (haversineMeters(myLocation, leftStation) <= leftRadius) return;
      waitingToLeaveIndexRef.current = null;
    }

    const idx = announcedStationIndexRef.current;
    if (idx >= stations.length) return;
    const station = stations[idx];
    const radius = voiceAnnounceRadiusM(idx, stations);
    if (haversineMeters(myLocation, station) > radius) return;

    announcedStationIndexRef.current = idx + 1;
    if (idx < stations.length - 1) waitingToLeaveIndexRef.current = idx;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const here = formatStationLabel(locale, stationSpeakName(station), station.viaSegmentName);
      const next = stations[idx + 1];
      const text = next
        ? t(locale, "route.voiceArrivedNext", {
            here,
            next: formatStationLabel(locale, stationSpeakName(next), next.viaSegmentName),
            direction: t(locale, `route.compass${compassDirection(bearing(station, next))}`),
          })
        : t(locale, "route.voiceArrivedFinal", { here });
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale === "de" ? "de-DE" : "en-US";
      window.speechSynthesis.speak(utterance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLocation, voiceEnabled, mode]);

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  async function callApi(path: string, body: unknown = {}): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function toggleFollow() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setMyLocation(null);
      setVoiceEnabled(false);
      trackBufferRef.current = [];
      walkStartedAtRef.current = null;
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy || 35;
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsAccuracyM(accuracy);
        // M4: Punkte nur in den Puffer, wenn die Route läuft (mode active) und die
        // Genauigkeit ausreicht — gefiltert auf ≥4 m Abstand (Android-Parität).
        if (mode === "active" && accuracy <= 40) {
          const last = trackBufferRef.current.length
            ? trackBufferRef.current[trackBufferRef.current.length - 1]!
            : null;
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy, time: new Date().toISOString() };
          if (!last || haversineMeters(last, { lat: p.lat, lng: p.lng }) >= 4) {
            if (walkStartedAtRef.current === null) walkStartedAtRef.current = Date.now();
            trackBufferRef.current.push(p);
          }
        }
      },
      () => setMyLocation(null),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    setWatchId(id);
  }

  function setVoiceChecked(checked: boolean) {
    if (checked) {
      if (watchId === null) toggleFollow();
      setVoiceEnabled(true);
    } else {
      setVoiceEnabled(false);
    }
  }

  async function generate(preset: LengthPreset) {
    if (!startNodeId) {
      flashMessage(t(locale, "route.noHomeNode"), true);
      return;
    }
    setStatus("loading");
    clearMessage();
    setSelectedNodeId(null);
    setSelectedSegmentId(null);

    const destination = isLoop ? startNodeId : endNodeId || startNodeId;
    const mustVisit = mustVisitNodeIds.filter((id) => id !== startNodeId && id !== destination);

    const res = await callApi("/api/route/generate", {
      startNodeId,
      destinationNodeId: destination,
      mustVisitNodeIds: mustVisit,
      requiredSegmentIds,
      excludedSegmentIds,
      explorerMode: preset === "surprise" ? false : explorerMode,
      forceGolden,
      preset,
    });

    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setAdopted(false); // neue Route ⇒ lokale Auswahl-Übernahme verwerfen (Grok)
      setUsingNetworkFallback(data.usingNetworkFallback ?? null);
      setStatus("idle");
      if (data.lengthRelaxed) {
        flashMessage(
          t(locale, "route.lengthRelaxed", { km: (data.lengthKm ?? data.route.lengthM / 1000).toFixed(2) }),
          false,
        );
      }
      if (data.closedNodeWarnings && data.closedNodeWarnings.length > 0) {
        flashMessage(t(locale, "route.closedNodesWarning"), false);
      }
    } else {
      setResult(null);
      setAdopted(false);
      setUsingNetworkFallback(null);
      setStatus("error");
      flashMessage(await readApiError(res), true);
    }
  }

  async function handleReverse() {
    if (!result?.token) return;
    setStatus("loading");
    const res = await callApi("/api/route/reverse", { token: result.token });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setAdopted(false); // neue/gedrehte Route ⇒ Auswahl-Übernahme verwerfen (Grok)
      setStatus("idle");
      clearMessage();
    } else {
      setStatus("idle");
      flashMessage(t(locale, "route.reverseFailed"), true);
    }
  }

  async function handleAnother() {
    if (!result) return;
    setStatus("loading");
    setAdopted(false);
    const res = await callApi("/api/route/widen", { token: result.token });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setUsingNetworkFallback(data.usingNetworkFallback ?? null);
      setStatus("idle");
      clearMessage();
      if (data.lengthRelaxed) {
        flashMessage(
          t(locale, "route.lengthRelaxed", { km: (data.lengthKm ?? data.route.lengthM / 1000).toFixed(2) }),
          false,
        );
      }
    } else {
      setStatus("idle");
      flashMessage(t(locale, "route.noAlternative"), true);
    }
  }

  async function handleAdjust(direction: "longer" | "shorter") {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/adjust", { token: result.token, direction });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setAdopted(false); // angepasste Route ⇒ Auswahl-Übernahme verwerfen (Grok)
      setStatus("idle");
      clearMessage();
    } else {
      setStatus("idle");
      flashMessage(t(locale, "route.noAlternative"), true);
    }
  }

  async function repositionNode(nodeId: number, lat: number, lng: number, accuracyM: number) {
    const node = nodesById.get(nodeId);
    if (node && isAdmin && haversineMeters(node, { lat, lng }) > 25) {
      if (!window.confirm(t(locale, "route.repositionAdminConfirm"))) return;
    }
    setStatus("loading");
    const res = await callApi("/api/route/reposition-node", { nodeId, lat, lng, accuracyM });
    setRepositionCandidates(null);
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; offPathWarning?: boolean };
      setStatus("idle");
      flashMessage(
        data.offPathWarning ? t(locale, "route.repositionOffPath") : t(locale, "route.repositionSuccess"),
        !!data.offPathWarning,
      );
      router.refresh();
    } else {
      setStatus("idle");
      flashMessage(t(locale, "common.error"), true);
    }
  }

  function handleRepositionClick() {
    if (!myLocation) {
      if (!navigator.geolocation) {
        flashMessage(t(locale, "record.locationError"), true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGpsAccuracyM(pos.coords.accuracy || 35);
          pickRepositionTarget({ lat: pos.coords.latitude, lng: pos.coords.longitude }, pos.coords.accuracy || 35);
        },
        () => flashMessage(t(locale, "record.locationError"), true),
        { enableHighAccuracy: true },
      );
      return;
    }
    pickRepositionTarget(myLocation, gpsAccuracyM);
  }

  function pickRepositionTarget(loc: { lat: number; lng: number }, accuracyM: number) {
    const maxDist = accuracyM + 30;
    const nearby = nodes
      .filter((n) => haversineMeters(n, loc) <= maxDist)
      .sort((a, b) => haversineMeters(a, loc) - haversineMeters(b, loc));
    if (nearby.length === 0) {
      flashMessage(t(locale, "common.error"), true);
      return;
    }
    if (nearby.length === 1) {
      void repositionNode(nearby[0]!.id, loc.lat, loc.lng, accuracyM);
      return;
    }
    setRepositionCandidates(nearby.map((n) => n.id));
  }

  const acceptInFlight = useRef(false);
  async function handleAccept() {
    if (!result) return;
    // M3-4: double-click guard — a second Go while the first accept is running
    // must not start two sessions.
    if (acceptInFlight.current) return;
    acceptInFlight.current = true;
    setStatus("loading");
    // Favorit: wurde schon bei /favorites/{id}/accept serverseitig als aktive
    // Route gespeichert (kein generate-Token) → kein /api/route/accept nötig.
    // Generierte Route: erst hier wird sie über den Token serverseitig aktiv.
    if (result.token) {
      const res = await callApi("/api/route/accept", { token: result.token });
      if (!res.ok) {
        acceptInFlight.current = false;
        setStatus("idle");
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 409) {
          // M3-4: another device/tab already has an active route — offer replace.
          if (
            window.confirm(t(locale, "route.activeRouteExists"))
          ) {
            const retry = await callApi("/api/route/accept", { token: result.token, replace: true });
            if (retry.ok) {
              acceptInFlight.current = false;
              setMode("active");
              setAdopted(false);
              onPhaseChange?.("active");
              setStatus("idle");
              clearMessage();
              setNickname("");
              announcedStationIndexRef.current = 0;
              waitingToLeaveIndexRef.current = null;
              return;
            }
            acceptInFlight.current = false;
            setStatus("idle");
            flashMessage(t(locale, "common.error"), true);
            return;
          }
          acceptInFlight.current = false;
          setStatus("idle");
          return;
        }
        if (res.status === 410 && body?.error === "session_expired") {
          // M3-4: 410 after an earlier 200 in this session means the session was
          // already consumed (e.g. another Go already started). Go into the walk.
          setMode("active");
          setAdopted(false);
          onPhaseChange?.("active");
          acceptInFlight.current = false;
          setStatus("idle");
          clearMessage();
          setNickname("");
          announcedStationIndexRef.current = 0;
          waitingToLeaveIndexRef.current = null;
          return;
        }
        flashMessage(t(locale, "route.sessionExpired"), true);
        return;
      }
    }
    setMode("active");
    setAdopted(false);
    onPhaseChange?.("active");
    acceptInFlight.current = false;
    setStatus("idle");
    clearMessage();
    setNickname("");
    announcedStationIndexRef.current = 0;
    waitingToLeaveIndexRef.current = null;
  }

  // Android-Parität: „Auswählen" übernimmt die Route nur lokal (Token bleibt),
  // die Bestätigungsseite mit „Go" erscheint erst — der Server-Token wird NICHT
  // vorzeitig verbraucht (sonst „Sitzung abgelaufen" beim Go, Android-Bug).
  function handleSelect() {
    if (!result) return;
    setAdopted(true);
    clearMessage();
  }

  // Verwerfen von der Zwischenseite (adopted): Bei einer generierten Route war
  // noch nichts Server-aktiv → nur lokal zurücksetzen. Bei einem Favoriten ist
  // die Route schon am Account aktiv (/favorites/{id}/accept) → serverseitig
  // discard, sonst hängt sie als aktive Route am Profil (/api/route/discard).
  async function handleDiscardAdopted() {
    if (!result) return;
    setStatus("loading");
    if (!result.token) {
      await callApi("/api/route/discard");
      setResult(null);
      setMode("suggesting");
      setAdopted(false);
      onPhaseChange?.("suggesting");
      setStatus("idle");
      clearMessage();
      return;
    }
    // Generierte Route: lokal entadopt, Token-Session bleibt unverbraucht.
    setAdopted(false);
    setStatus("idle");
    clearMessage();
  }

  async function saveNickname() {
    setNicknameStatus("saving");
    const res = await callApi("/api/route/nickname", { nickname });
    setNicknameStatus("idle");
    if (res.ok) {
      flashMessage(t(locale, "route.nicknameSaved"));
      router.refresh();
    } else {
      flashMessage(t(locale, "common.error"), true);
    }
  }

  async function handleCancel() {
    if (!result) return;
    await callApi("/api/route/cancel", { token: result.token });
    setResult(null);
    setAdopted(false);
    clearMessage();
  }

  async function handleComplete() {
    setStatus("loading");
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const completedRoute = result?.route;
    // M4: Track + tatsächliche Dauer mitschicken. durationMin = seit dem ersten
    // GPS-Fix nach Go verstrichene Minuten (floor, mindestens 1). Der Server
    // speichert diesen Wert als Ist-Dauer statt der geplanten Plan-Dauer.
    const startedAt = walkStartedAtRef.current;
    const durationMin = startedAt !== null ? Math.max(1, Math.floor((Date.now() - startedAt) / 60000)) : undefined;
    const res = await callApi("/api/route/complete", {
      trackPoints: trackBufferRef.current.slice(-5000),
      ...(durationMin !== undefined ? { durationMin } : {}),
    });
    if (res.ok) {
      playRoutySound("route_finish");
      const data = (await res.json()) as RouteCompletionData;
      trackBufferRef.current = [];
      walkStartedAtRef.current = null;
      setResult(null);
      setMode("suggesting");
      setAdopted(false);
      // Wichtig (Grok-Finding): OHNE onPhaseChange bleibt RoutePane phase=active
      // → Frei-Pane bleibt blockiert + Gehen-Dock/Stop-Prompt hängt. Erst das
      // Signal zurück auf suggesting räumt liveSession/GO-Zwang auf.
      onPhaseChange?.("suggesting");
      setStatus("idle");
      setCompletionData({
        ...data,
        route: completedRoute
          ? {
              nodeChain: completedRoute.nodeChain,
              segmentIds: completedRoute.segmentIds,
              lengthM: completedRoute.lengthM,
              durationMin: completedRoute.durationMin,
            }
          : undefined,
      });
      if (typeof window !== "undefined" && "speechSynthesis" in window && data.celebrationTier !== "normal") {
        const utterance = new SpeechSynthesisUtterance(t(locale, "route.celebration"));
        utterance.lang = locale === "de" ? "de-DE" : "en-US";
        window.speechSynthesis.speak(utterance);
      }
      setPointBalance((prev) => (prev !== null ? prev + data.pointsEarned : data.pointsEarned));
      setNickname("");
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
        setMyLocation(null);
      }
    } else {
      setStatus("idle");
      flashMessage(t(locale, "common.error"), true);
    }
  }

  async function handleDiscardActive(opts?: { skipConfirm?: boolean }) {
    if (!opts?.skipConfirm && !window.confirm(t(locale, "route.discardConfirm"))) return;
    setStatus("loading");
    await callApi("/api/route/discard");
    setResult(null);
    setMode("suggesting");
    setAdopted(false);
    onPhaseChange?.("suggesting");
    setStatus("idle");
    clearMessage();
    setNickname("");
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setMyLocation(null);
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    trackBufferRef.current = [];
    walkStartedAtRef.current = null;
  }

  // M3-3/Q1: Der Dock-Stop auf der Zwischenseite (adopted, Mode suggesting) darf
  // bei einer generierten Route KEINE Discard-API rufen — der Token bleibt
  // unverbraucht und der Vorschlag steht weiter. Nur lokal de-adoptieren. Bei
  // einer echten Live-Route (phase active) ist das der normale Discard.
  async function stopLive() {
    if (mode === "active" || !result) {
      await handleDiscardActive({ skipConfirm: true });
      return;
    }
    // Zwischenseite: adopted + Token → nur lokal zurücksetzen (Q1).
    if (result.token) {
      setAdopted(false);
      clearMessage();
      return;
    }
    // Zwischenseite + leerer Token (Favorit/Share/Bootstrap hängen am Account):
    // serverseitig verwerfen, sonst bleibt die Route am Profil aktiv.
    await handleDiscardAdopted();
  }

  // §7.2/H1: Discard-Handle für die Hülle — der durch MapDock bestätigte Moduswechsel
  // beendet die aktive Route über diesen Handle (skipConfirm, denn der Bestätigungs-
  // Dialog kam schon im Dock). Watch wird dabei über den bestehenden Pfad gestoppt (H2).
  useImperativeHandle(
    ref,
    () => ({
      discardActive: (opts?: { skipConfirm?: boolean }) => handleDiscardActive(opts),
      stopLive: () => stopLive(),
    }),
    [handleDiscardActive],
  );

  async function handleLoadFavorite(favorite: FavoriteEntry) {
    setStatus("loading");
    setFavoritesOpen(false);
    const res = await callApi(`/api/favorites/${favorite.id}/accept`);
    if (res.ok) {
      // Parität mit Android/altem System: Der Favorit wird serverseitig als
      // aktive Route am Account gespeichert (/accept tut das), aber der Client
      // bleibt auf der Zwischenseite (wie beim frischen Auswählen): Route ist
      // gezeichnet, man wählt die Ansage und drückt erst „Go“ zum Starten.
      // Kein sofortiger mode=active/Go-Sprung mehr.
      setResult({ token: "", route: favorite.display });
      setAdopted(true);
      setStatus("idle");
      clearMessage();
      setNickname("");
      announcedStationIndexRef.current = 0;
      waitingToLeaveIndexRef.current = null;
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("idle");
      flashMessage(body?.error === "favorite_stale" ? t(locale, "route.favoriteStale") : t(locale, "common.error"), true);
    }
  }

  async function handleDeleteFavorite(id: number) {
    if (!window.confirm(t(locale, "route.favoriteDeleteConfirm"))) return;
    const res = await callApi(`/api/favorites/${id}/delete`);
    if (res.ok) {
      setDeletedFavoriteIds((prev) => new Set(prev).add(id));
    }
  }

  const summaryParts: string[] = [];
  if (isLoop) {
    summaryParts.push(t(locale, "route.summaryLoop", { start: nodeLabel(startNodeId) }));
  } else {
    summaryParts.push(
      t(locale, "route.summaryPointToPoint", { start: nodeLabel(startNodeId), end: nodeLabel(endNodeId) }),
    );
  }
  if (mustVisitNodeIds.length > 0) {
    summaryParts.push(t(locale, "route.summaryMustVisit", { count: mustVisitNodeIds.length }));
  }
  if (requiredSegmentIds.length > 0) {
    summaryParts.push(t(locale, "route.summaryRequired", { count: requiredSegmentIds.length }));
  }
  if (excludedSegmentIds.length > 0) {
    summaryParts.push(t(locale, "route.summaryExcluded", { count: excludedSegmentIds.length }));
  }
  const summaryText = summaryParts.join(" · ");

  const actionBar = result ? (
    <div className="route-action-bar">
      {mode === "suggesting" ? (
        adopted ? (
          <>
            <div className="btn-row" style={{ gap: "0.65rem", flexWrap: "wrap" }}>
              <label className="checkbox" style={{ fontSize: "0.82rem" }} title={t(locale, "route.voiceHint")}>
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  disabled={!followEnabled}
                  onChange={(e) => setVoiceChecked(e.target.checked)}
                />
                {t(locale, "route.voiceCheck")}
              </label>
            </div>
            <div className="btn-row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
              <button type="button" className="btn-primary btn-compact" onClick={handleAccept} disabled={status === "loading"}>
                {t(locale, "route.goButton")}
              </button>
              <button
                type="button"
                className="btn-danger btn-compact"
                onClick={handleDiscardAdopted}
                disabled={status === "loading"}
              >
                {t(locale, "route.discardButton")}
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={() => handleAdjust("shorter")} disabled={status === "loading"}>
              {t(locale, "route.shorter")}
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={handleAnother} disabled={status === "loading"}>
              {t(locale, "route.again")}
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={() => handleAdjust("longer")} disabled={status === "loading"}>
              {t(locale, "route.longer")}
            </button>
            {result.token ? (
              <button type="button" className="btn-secondary btn-compact" onClick={handleReverse} disabled={status === "loading"}>
                {t(locale, "route.reverse")}
              </button>
            ) : null}
            <button type="button" className="btn-primary btn-compact" onClick={handleSelect} disabled={status === "loading"}>
              {t(locale, "route.selectButton")}
            </button>
            <button type="button" className="btn-danger btn-compact" onClick={handleCancel} disabled={status === "loading"}>
              {t(locale, "route.cancel")}
            </button>
          </>
        )
      ) : (
        <>
          <div className="btn-row" style={{ gap: "0.65rem", flexWrap: "wrap" }}>
            <label className="checkbox" style={{ fontSize: "0.82rem" }} title={t(locale, "route.showLocation")}>
              <input type="checkbox" checked={followEnabled} onChange={() => toggleFollow()} />
              {t(locale, "route.followCheck")}
            </label>
            <label className="checkbox" style={{ fontSize: "0.82rem" }} title={t(locale, "route.voiceHint")}>
              <input
                type="checkbox"
                checked={voiceEnabled}
                disabled={!followEnabled}
                onChange={(e) => setVoiceChecked(e.target.checked)}
              />
              {t(locale, "route.voiceCheck")}
            </label>
          </div>
          <button type="button" className="btn-secondary btn-compact" onClick={handleRepositionClick} disabled={status === "loading"} title={t(locale, "route.repositionNodeHint")}>
            {t(locale, "route.repositionNode")}
          </button>
          <button type="button" className="btn-primary btn-compact" onClick={handleComplete} disabled={status === "loading"}>
            {t(locale, "route.completeButton")}
          </button>
          <button type="button" className="btn-danger btn-compact" onClick={() => void handleDiscardActive()} disabled={status === "loading"}>
            {t(locale, "route.discardButton")}
          </button>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={t(locale, "route.routeNamePlaceholder")}
            style={{ maxWidth: "10rem", fontSize: "0.82rem", padding: "0.35rem 0.5rem" }}
          />
          <button type="button" className="btn-secondary btn-compact" onClick={saveNickname} disabled={nicknameStatus === "saving"}>
            {t(locale, "route.saveName")}
          </button>
        </>
      )}
    </div>
  ) : null;

  // M3-2/F18: Der „go"-Chip ist NICHT mehr leer, wenn eine Route nur übernommen
  // (adopted) und noch nicht gestartet ist — die Zwischenseite (Ansage + Go +
  // Verwerfen) wird dort gerendert statt null. Frei (Free Roam) erscheint nur,
  // wenn keine Route übernommen wurde und nichts aktiv ist. Nach Complete/Discard
  // sind adopted=false und phase=suggesting → Free Roam kommt zurück.
  if (section === "hidden") return null;
  if (section === "go" && mode !== "active" && !adopted) return null;

  return (
    <div className="route-shell">
      <div className="route-controls-pane">
        {pointBalance !== null && (
          <div className="btn-row" style={{ marginBottom: "0.35rem" }}>
            <span className="chip">{t(locale, "route.pointBalance", { points: pointBalance })}</span>
            {dailyChallenge && (
              <span className="chip" style={{ backgroundColor: "#fdf6e3", color: "#7c3aed" }}>
                🎯 {dailyChallenge}
              </span>
            )}
            {(result?.goldenHits ?? result?.goldenHitIds?.length ?? 0) > 0 ? (
              <span className="chip">
                {t(locale, "route.goldenOnRoute")}: {result!.goldenHits ?? result!.goldenHitIds!.length}
              </span>
            ) : !result && goldenSegmentIds.length > 0 ? (
              <span className="chip">{t(locale, "route.goldenToday")}: {goldenSegmentIds.length}</span>
            ) : null}
          </div>
        )}

        {section === "plan" && mode === "suggesting" && !result && (
          <div className="stack" style={{ gap: "0.45rem" }}>
            <span className="chip route-summary-chip" title={summaryText}>
              {summaryText}
            </span>

            {(requiredSegmentIds.length > 0 || excludedSegmentIds.length > 0) && (
              <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.3rem" }}>
                {requiredSegmentIds.map((id) => (
                  <span key={`req-${id}`} className="chip route-segment-badge route-segment-badge-required route-abbrev-display" title={segmentLabel(id)}>
                    {t(locale, "route.badgeRequired")}: {segmentLabel(id)}
                  </span>
                ))}
                {excludedSegmentIds.map((id) => (
                  <span key={`ex-${id}`} className="chip route-segment-badge route-segment-badge-excluded route-abbrev-display" title={segmentLabel(id)}>
                    {t(locale, "route.badgeExcluded")}: {segmentLabel(id)}
                  </span>
                ))}
              </div>
            )}

            <p className="hint-compact route-map-hint">{t(locale, "route.mapTapHint")}</p>

            {selectedNodeId !== null && nodesById.get(selectedNodeId) && (
              <div className="route-selection-bar route-selection-stack">
                <strong className="route-abbrev-display">{nodesById.get(selectedNodeId)!.name || `#${selectedNodeId}`}</strong>
                <div className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setNodeAsStart(selectedNodeId)}>
                    {t(locale, "route.nodeMenuStart")}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setNodeAsEnd(selectedNodeId)}>
                    {t(locale, "route.nodeMenuEnd")}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => toggleMustVisit(selectedNodeId)}>
                    {t(locale, "route.nodeMenuMustVisit")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => {
                      clearNodeRole(selectedNodeId);
                      setSelectedNodeId(null);
                    }}
                  >
                    {t(locale, "route.nodeMenuClear")}
                  </button>
                </div>
              </div>
            )}

            {selectedSegmentId !== null && (
              <div className="route-selection-bar route-selection-stack">
                <strong className="route-abbrev-display">{segmentLabel(selectedSegmentId)}</strong>
                <div className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setSegmentRequired(selectedSegmentId)}>
                    {t(locale, "route.segmentMenuRequired")}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setSegmentExcluded(selectedSegmentId)}>
                    {t(locale, "route.segmentMenuExcluded")}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => clearSegmentConstraint(selectedSegmentId)}>
                    {t(locale, "route.segmentMenuClear")}
                  </button>
                </div>
              </div>
            )}

            <details className="route-more-options">
              <summary>{t(locale, "route.moreOptions")}</summary>
              <div className="btn-row" style={{ marginTop: "0.45rem" }}>
                <label className="checkbox" title={t(locale, "route.loopHint")}>
                  <input
                    type="checkbox"
                    checked={isLoop}
                    onChange={(e) => {
                      const loop = e.target.checked;
                      setIsLoop(loop);
                      // Parität mit der App: Runde ⇔ kein Ziel gesetzt.
                      if (loop) setEndNodeId(homeNodeId ?? "");
                    }}
                  />
                  {t(locale, "route.loop")}
                </label>
                <label className="checkbox" title={t(locale, "route.explorerModeHint")}>
                  <input type="checkbox" checked={explorerMode} onChange={(e) => setExplorerMode(e.target.checked)} />
                  {t(locale, "route.explorerMode")}
                </label>
                <label className="checkbox" title={t(locale, "route.forceGoldenHint")}>
                  <input type="checkbox" checked={forceGolden} onChange={(e) => setForceGolden(e.target.checked)} />
                  {t(locale, "route.forceGolden")}
                </label>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={status === "loading" || !startNodeId}
                  onClick={() => generate("surprise")}
                  title={t(locale, PRESET_HINT_KEYS.surprise)}
                >
                  {t(locale, "route.presetSurprise")}
                </button>
                {(endNodeId !== "" && !isLoop) ||
                mustVisitNodeIds.length > 0 ||
                requiredSegmentIds.length > 0 ||
                excludedSegmentIds.length > 0 ? (
                  <button type="button" className="btn-secondary btn-compact" onClick={resetPlanning}>
                    {t(locale, "route.nodeMenuClearAll")}
                  </button>
                ) : null}
              </div>
            </details>

            <div className="route-action-bar">
              <div className="btn-row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                {(["short", "normal", "long"] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={preset === lengthPreset ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                    disabled={status === "loading"}
                    onClick={() => setLengthPreset(preset)}
                    title={t(locale, PRESET_HINT_KEYS[preset])}
                  >
                    {t(locale, PRESET_LABEL_KEYS[preset])}
                  </button>
                ))}
              </div>
              <div className="btn-row" style={{ gap: "0.4rem", marginTop: "0.6rem" }}>
                <button
                  type="button"
                  className="btn-primary btn-compact route-generate-arrow"
                  disabled={status === "loading" || !startNodeId}
                  onClick={() => generate(lengthPreset)}
                  title={t(locale, "route.generateHint")}
                  aria-label={t(locale, "route.generateHint")}
                >
                  {status === "loading" ? "…" : t(locale, "route.generateLabel")}
                </button>
              </div>
              <div className="btn-row" style={{ gap: "0.4rem", marginTop: "1.1rem" }}>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => setFavoritesOpen((o) => !o)}
                >
                  {favorites.length > 0
                    ? `${t(locale, "route.favoritesTitle")} (${favorites.length})`
                    : t(locale, "route.favoritesTitle")}
                </button>
              </div>
            </div>
            {favoritesOpen && (
              <div className="card route-panel-compact" style={{ marginTop: "0.35rem" }}>
                {favorites.length === 0 ? (
                  <p className="hint" style={{ margin: 0 }}>
                    {t(locale, "route.favoritesEmpty")}
                  </p>
                ) : (
                  favorites.map((fav) => (
                    <div key={fav.id} className="route-favorite-row">
                      <span className="chip">
                        {fav.name} · {(fav.display.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => handleLoadFavorite(fav)}
                        disabled={status === "loading"}
                      >
                        {t(locale, "route.favoriteTake")}
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-compact"
                        onClick={() => handleDeleteFavorite(fav.id)}
                      >
                        {t(locale, "map.delete")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {mode === "active" && !result && (
          <div className="alert alert-success" style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem" }}>
            {t(locale, "route.activeNotice")}
          </div>
        )}

        {message && (
          <div
            className={`alert ${messageIsError ? "alert-error" : "alert-success"}`}
            style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem" }}
          >
            {message}
          </div>
        )}

        {actionBar && <div className="route-action-bar-sticky">{actionBar}</div>}
      </div>

      {completionData && (
        <RouteCompletionDialog locale={locale} data={completionData} onClose={() => setCompletionData(null)} />
      )}

      {pendingDestinationReplace !== null && (
        <div className="card" style={{ position: "fixed", bottom: "4.5rem", left: "50%", transform: "translateX(-50%)", zIndex: 1200, maxWidth: "90vw" }}>
          <strong style={{ fontSize: "0.95rem" }}>{t(locale, "route.destinationReplaceTitle")}</strong>
          <p className="hint-compact" style={{ margin: "0.35rem 0 0 0" }}>
            {t(locale, "route.destinationReplaceBody", {
              dest: nodeLabel(endNodeId),
            })}
          </p>
          <div className="btn-row" style={{ marginTop: "0.6rem" }}>
            <button type="button" className="btn-primary btn-compact" onClick={confirmReplaceDestination}>
              {t(locale, "route.destinationReplaceConfirm")}
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={dismissReplaceDestination}>
              {t(locale, "route.destinationReplaceCancel")}
            </button>
          </div>
        </div>
      )}

      {repositionCandidates && myLocation && (
        <div className="card" style={{ position: "fixed", bottom: "4.5rem", left: "50%", transform: "translateX(-50%)", zIndex: 1200, maxWidth: "90vw" }}>
          <p className="hint-compact">{t(locale, "route.repositionPickNode")}</p>
          <div className="btn-row">
            {repositionCandidates.map((id) => (
              <button
                key={id}
                type="button"
                className="btn-secondary btn-compact"
                onClick={() => void repositionNode(id, myLocation.lat, myLocation.lng, gpsAccuracyM)}
              >
                {nodeLabel(id)}
              </button>
            ))}
            <button type="button" className="btn-secondary btn-compact" onClick={() => setRepositionCandidates(null)}>
              {t(locale, "common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
