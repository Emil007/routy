"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { haversineMeters, bearing, compassDirection } from "@/lib/geo";
import { playRoutySound } from "@/lib/sounds";
import {
  formatStationLabel,
  stationSpeakName,
  voiceAnnounceRadiusM,
} from "@/lib/voiceAnnounce";
import { MapViewLazy } from "./MapViewLazy";
import { RouteCompletionDialog, type RouteCompletionData } from "./RouteCompletionDialog";
import type { MapLine, MapMarker } from "./MapView";
import type { NodeRow } from "@/lib/nodes";
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
}

interface FavoriteEntry {
  id: number;
  name: string;
  shareToken: string | null;
  display: RouteDisplay;
}

type LengthPreset = "short" | "normal" | "long" | "surprise";

const PRESET_LABEL_KEYS: Record<LengthPreset, string> = {
  short: "route.presetShort",
  normal: "route.presetNormal",
  long: "route.presetLong",
  surprise: "route.presetSurprise",
};

const PRESET_HINT_KEYS: Record<LengthPreset, string> = {
  short: "route.presetShortHint",
  normal: "route.presetNormalHint",
  long: "route.presetLongHint",
  surprise: "route.presetSurpriseHint",
};

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
}: {
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
}) {
  const router = useRouter();
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [deletedFavoriteIds, setDeletedFavoriteIds] = useState<Set<number>>(() => new Set());
  const favorites = useMemo(
    () => initialFavorites.filter((f) => !deletedFavoriteIds.has(f.id)),
    [initialFavorites, deletedFavoriteIds],
  );
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  const [startNodeId, setStartNodeId] = useState<number | "">(homeNodeId ?? "");
  const [isLoop, setIsLoop] = useState(true);
  const [endNodeId, setEndNodeId] = useState<number | "">(homeNodeId ?? "");
  const [mustVisitNodeIds, setMustVisitNodeIds] = useState<number[]>([]);
  const [requiredSegmentIds, setRequiredSegmentIds] = useState<number[]>([]);
  const [excludedSegmentIds, setExcludedSegmentIds] = useState<number[]>([]);
  const [explorerMode, setExplorerMode] = useState(false);
  const [forceGolden, setForceGolden] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);

  const [mode, setMode] = useState<"suggesting" | "active">(initialActiveRoute ? "active" : "suggesting");
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
  const [goldenSegmentIds, setGoldenSegmentIds] = useState<number[]>([]);
  const [completionData, setCompletionData] = useState<RouteCompletionData | null>(null);
  const [usingNetworkFallback, setUsingNetworkFallback] = useState<boolean | null>(initialUsingNetworkFallback);
  const announcedStationIndexRef = useRef(0);
  const waitingToLeaveIndexRef = useRef<number | null>(null);
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

  function setNodeAsEnd(nodeId: number) {
    clearNodeRole(nodeId);
    setEndNodeId(nodeId);
    setSelectedNodeId(null);
  }

  function toggleMustVisit(nodeId: number) {
    if (mustVisitNodeIds.includes(nodeId)) {
      setMustVisitNodeIds((prev) => prev.filter((id) => id !== nodeId));
    } else {
      if (startNodeId === nodeId) setStartNodeId(homeNodeId ?? "");
      if (endNodeId === nodeId) setEndNodeId(homeNodeId ?? "");
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
    const lines: MapLine[] = [{ id: "route", points: result.route.geometry }];
    const hitIds = new Set(
      result.goldenHitIds ?? result.route.segmentIds.filter((id) => goldenSet.has(id)),
    );
    for (const segmentId of goldenSegmentIds) {
      const points = segmentGeometries[segmentId];
      if (!points?.length) continue;
      const onRoute = hitIds.has(segmentId);
      lines.push({
        id: `golden-${segmentId}`,
        points,
        color: "#c99a2e",
        dashed: true,
        weight: onRoute ? 7 : 5,
      });
    }
    return lines;
  }, [result, goldenSet, goldenSegmentIds, segmentGeometries]);

  const networkMapLines = useMemo((): MapLine[] => {
    if (mode !== "suggesting" || result) return [];
    const lines: MapLine[] = [];
    for (const segmentId of canonicalSegmentIds) {
      const points = segmentGeometries[segmentId];
      if (!points?.length) continue;
      const isRequired = requiredSet.has(segmentId);
      const isExcluded = excludedSet.has(segmentId);
      const isGolden = goldenSet.has(segmentId);
      lines.push({
        id: segmentId,
        points,
        color: isExcluded ? "#c53030" : isRequired ? "#2b6cb0" : isGolden ? "#c99a2e" : "#6b9080",
        weight: isRequired || isGolden ? 6 : 4,
        dashed: isExcluded || isGolden,
      });
    }
    return lines;
  }, [mode, result, canonicalSegmentIds, segmentGeometries, requiredSet, excludedSet, goldenSet]);

  const planningMarkers = useMemo((): MapMarker[] => {
    if (mode !== "suggesting" || result) return [];
    return nodes.map((n) => {
      let badge: string | undefined;
      let color = "#2e6b49";
      if (n.id === startNodeId) {
        badge = t(locale, "route.badgeStart");
        color = "#a5711c";
      } else if (!isLoop && n.id === endNodeId) {
        badge = t(locale, "route.badgeEnd");
        color = "#a5711c";
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
    : `plan-${startNodeId}-${mustVisitNodeIds.join(",")}-${requiredSegmentIds.join(",")}`;

  async function readApiError(res: Response): Promise<string> {
    const data = (await res.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null;
    if (res.status === 429 && data?.error === "rate_limited") {
      return t(locale, "route.rateLimited", { seconds: data.retryAfterSeconds ?? 60 });
    }
    if (data?.error === "no_home_node") return t(locale, "route.noHomeNode");
    if (data?.error === "no_golden_route") return t(locale, "route.noGoldenRoute");
    if (data?.error === "constraints_impossible") return t(locale, "route.constraintsImpossible");
    return t(locale, "route.noRouteFound");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/app/game/daily");
      if (!cancelled && res.ok) {
        const data = (await res.json()) as { pointBalance: number; goldenSegments: { segmentId: number }[] };
        setPointBalance(data.pointBalance);
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
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
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
      setUsingNetworkFallback(data.usingNetworkFallback ?? null);
      setStatus("idle");
      if (data.lengthRelaxed) {
        flashMessage(
          t(locale, "route.lengthRelaxed", { km: (data.lengthKm ?? data.route.lengthM / 1000).toFixed(2) }),
          false,
        );
      }
    } else {
      setResult(null);
      setUsingNetworkFallback(null);
      setStatus("error");
      flashMessage(await readApiError(res), true);
    }
  }

  async function handleAnother() {
    if (!result) return;
    setStatus("loading");
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
      setStatus("idle");
      clearMessage();
    } else {
      setStatus("idle");
      flashMessage(t(locale, "route.noAlternative"), true);
    }
  }

  async function handleAccept() {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/accept", { token: result.token });
    if (res.ok) {
      setMode("active");
      setStatus("idle");
      clearMessage();
      setNickname("");
      announcedStationIndexRef.current = 0;
      waitingToLeaveIndexRef.current = null;
    } else {
      setStatus("idle");
      flashMessage(t(locale, "route.sessionExpired"), true);
    }
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
    clearMessage();
  }

  async function handleComplete() {
    setStatus("loading");
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const completedRoute = result?.route;
    const res = await callApi("/api/route/complete", {});
    if (res.ok) {
      playRoutySound("route_finish");
      const data = (await res.json()) as RouteCompletionData;
      setResult(null);
      setMode("suggesting");
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

  async function handleDiscardActive() {
    if (!window.confirm(t(locale, "route.discardConfirm"))) return;
    setStatus("loading");
    await callApi("/api/route/discard");
    setResult(null);
    setMode("suggesting");
    setStatus("idle");
    clearMessage();
    setNickname("");
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setMyLocation(null);
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  async function handleLoadFavorite(favorite: FavoriteEntry) {
    setStatus("loading");
    setFavoritesOpen(false);
    const res = await callApi(`/api/favorites/${favorite.id}/accept`);
    if (res.ok) {
      setResult({ token: "", route: favorite.display });
      setMode("active");
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

  const routeChips = result ? (
    <>
      <span className="chip">
        {t(locale, "route.distanceLabel")}: {(result.route.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
      </span>
      <span className="chip">
        {t(locale, "route.durationLabel")}: {result.route.durationMin} {t(locale, "common.min")}
      </span>
      {result.route.elevation && (
        <>
          <span className="chip">↗ {t(locale, "route.elevationGain", { gain: result.route.elevation.gainM })}</span>
          <span className="chip">↘ {t(locale, "route.elevationLoss", { loss: result.route.elevation.lossM })}</span>
        </>
      )}
      {result.pointPreview && (
        <>
          <span className="chip">{t(locale, "route.pointPreview", { points: result.pointPreview.total })}</span>
          <span className="chip">{t(locale, "route.pointPreviewBase", { points: result.pointPreview.base })}</span>
          {result.pointPreview.golden > 0 && (
            <span className="chip">{t(locale, "route.pointPreviewGolden", { points: result.pointPreview.golden })}</span>
          )}
          {result.pointPreview.exploration > 0 && (
            <span className="chip">{t(locale, "route.pointPreviewExploration", { points: result.pointPreview.exploration })}</span>
          )}
          {result.pointPreview.diversity > 0 && (
            <span className="chip">{t(locale, "route.pointPreviewDiversity", { points: result.pointPreview.diversity })}</span>
          )}
        </>
      )}
    </>
  ) : null;

  const actionBar = result ? (
    <div className="route-action-bar">
      {mode === "suggesting" ? (
        <>
          <button type="button" className="btn-secondary btn-compact" onClick={() => handleAdjust("shorter")} disabled={status === "loading"}>
            {t(locale, "route.shorter")}
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={() => handleAdjust("longer")} disabled={status === "loading"}>
            {t(locale, "route.longer")}
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={handleAnother} disabled={status === "loading"}>
            {t(locale, "route.newRoute")}
          </button>
          <button type="button" className="btn-primary btn-compact" onClick={handleAccept} disabled={status === "loading"}>
            {t(locale, "route.accept")}
          </button>
          <button type="button" className="btn-danger btn-compact" onClick={handleCancel} disabled={status === "loading"}>
            {t(locale, "route.cancel")}
          </button>
        </>
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
          <button type="button" className="btn-primary btn-compact" onClick={handleComplete} disabled={status === "loading"}>
            {t(locale, "route.completeButton")}
          </button>
          <button type="button" className="btn-danger btn-compact" onClick={handleDiscardActive} disabled={status === "loading"}>
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

  return (
    <div className="route-shell has-map">
      <div className="route-map-pane">
        <MapViewLazy
          fitKey={mapFitKey}
          lines={mapLines}
          markers={mapMarkers}
          onMarkerClick={mode === "suggesting" && !result ? handleMarkerClick : undefined}
          onLineClick={mode === "suggesting" && !result ? handleLineClick : undefined}
          height={360}
        />
        {result && routeChips && (
          <div className="route-action-bar" style={{ marginTop: "0.45rem" }}>
            {routeChips}
          </div>
        )}
        {result && (
          <p
            className="route-stations-oneline route-abbrev-display"
            title={result.route.shortStationGroups
              .map((g) => (g.viaSegmentName ? `${g.text} (${t(locale, "route.via", { name: g.viaSegmentName })})` : g.text))
              .join(" › ")}
          >
            {result.route.shortStationGroups
              .map((g) => (g.viaSegmentName ? `${g.text} (${t(locale, "route.via", { name: g.viaSegmentName })})` : g.text))
              .join(" › ")}
          </p>
        )}
      </div>

      <div className="route-controls-pane">
        {pointBalance !== null && (
          <div className="btn-row" style={{ marginBottom: "0.35rem" }}>
            <span className="chip">{t(locale, "route.pointBalance", { points: pointBalance })}</span>
            {(result?.goldenHits ?? result?.goldenHitIds?.length ?? 0) > 0 ? (
              <span className="chip">
                {t(locale, "route.goldenOnRoute")}: {result!.goldenHits ?? result!.goldenHitIds!.length}
              </span>
            ) : goldenSegmentIds.length > 0 ? (
              <span className="chip">{t(locale, "route.goldenToday")}: {goldenSegmentIds.length}</span>
            ) : null}
          </div>
        )}

        {mode === "suggesting" && !result && (
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
              <div className="route-selection-bar">
                <strong className="route-abbrev-display">{nodesById.get(selectedNodeId)!.name || `#${selectedNodeId}`}</strong>
                <button type="button" className="btn-secondary btn-compact" onClick={() => setNodeAsStart(selectedNodeId)}>
                  {t(locale, "route.nodeMenuStart")}
                </button>
                {!isLoop && (
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setNodeAsEnd(selectedNodeId)}>
                    {t(locale, "route.nodeMenuEnd")}
                  </button>
                )}
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
            )}

            {selectedSegmentId !== null && (
              <div className="route-selection-bar">
                <strong className="route-abbrev-display">{segmentLabel(selectedSegmentId)}</strong>
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
            )}

            <details className="route-more-options">
              <summary>{t(locale, "route.moreOptions")}</summary>
              <div className="btn-row" style={{ marginTop: "0.45rem" }}>
                <label className="checkbox" title={t(locale, "route.loopHint")}>
                  <input
                    type="checkbox"
                    checked={isLoop}
                    onChange={(e) => {
                      setIsLoop(e.target.checked);
                      if (e.target.checked && startNodeId) setEndNodeId(startNodeId);
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
              </div>
            </details>

            <div className="route-action-bar">
              {(usingNetworkFallback === true || usingNetworkFallback === false) && (
                <span
                  className="chip"
                  title={
                    usingNetworkFallback
                      ? t(locale, "route.lengthTasteNetworkHint")
                      : t(locale, "route.lengthTastePersonalHint")
                  }
                >
                  {usingNetworkFallback ? t(locale, "route.lengthTasteNetwork") : t(locale, "route.lengthTastePersonal")}
                </span>
              )}
              {favorites.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => setFavoritesOpen((o) => !o)}
                >
                  {t(locale, "route.favoritesTitle")} ({favorites.length})
                </button>
              )}
              {(["short", "normal", "long", "surprise"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={preset === "short" ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                  disabled={status === "loading" || !startNodeId}
                  onClick={() => generate(preset)}
                  title={t(locale, PRESET_HINT_KEYS[preset])}
                >
                  {status === "loading" ? t(locale, "route.generating") : t(locale, PRESET_LABEL_KEYS[preset])}
                </button>
              ))}
            </div>
            {favoritesOpen && favorites.length > 0 && (
              <div className="card route-panel-compact" style={{ marginTop: "0.35rem" }}>
                {favorites.map((fav) => (
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
                ))}
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
    </div>
  );
}
