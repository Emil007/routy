"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { haversineMeters, bearing, compassDirection } from "@/lib/geo";
import { MapViewLazy } from "./MapViewLazy";
import { RouteCompletionDialog, type RouteCompletionData } from "./RouteCompletionDialog";
import type { NodeRow } from "@/lib/nodes";

const VOICE_ANNOUNCE_RADIUS_M = 50;

interface RouteStation {
  nodeId: number;
  name: string | null;
  lat: number;
  lng: number;
}

interface ShortStationGroup {
  text: string;
  viaSegmentName: string | null;
}

interface RouteDisplayPayload {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  stations: RouteStation[];
  shortStationGroups: ShortStationGroup[];
  elevation: { gainM: number; lossM: number } | null;
  geometry: [number, number][];
}

interface GenerateResponse {
  token: string;
  route: RouteDisplayPayload;
  pointPreview?: { base: number; golden: number; exploration: number; diversity: number; total: number };
  goldenHits?: number;
  goldenHitIds?: number[];
}

interface FavoriteEntry {
  id: number;
  name: string;
  shareToken: string | null;
  display: RouteDisplayPayload;
}

export function RouteGenerator({
  locale,
  nodes,
  homeNodeId,
  initialActiveRoute,
  initialNickname,
  favorites,
  segmentGeometries,
}: {
  locale: Locale;
  nodes: NodeRow[];
  homeNodeId: number | null;
  initialActiveRoute: RouteDisplayPayload | null;
  initialNickname: string | null;
  favorites: FavoriteEntry[];
  segmentGeometries: Record<number, [number, number][]>;
}) {
  const router = useRouter();
  const [startNodeId, setStartNodeId] = useState<number | "">(homeNodeId ?? "");
  const [isLoop, setIsLoop] = useState(true);
  const [destinationNodeId, setDestinationNodeId] = useState<number | "">(homeNodeId ?? "");
  const [waypointNodeId, setWaypointNodeId] = useState<number | "">("");
  const [explorerMode, setExplorerMode] = useState(false);
  const [forceGolden, setForceGolden] = useState(false);

  const [mode, setMode] = useState<"suggesting" | "active">(initialActiveRoute ? "active" : "suggesting");
  const [result, setResult] = useState<GenerateResponse | null>(
    initialActiveRoute ? { token: "", route: initialActiveRoute } : null,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [savingFavorite, setSavingFavorite] = useState(false);

  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "saving">("idle");

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [pointBalance, setPointBalance] = useState<number | null>(null);
  const [goldenSegmentIds, setGoldenSegmentIds] = useState<number[]>([]);
  const [completionData, setCompletionData] = useState<RouteCompletionData | null>(null);
  const announcedStationIndexRef = useRef(0);

  function flashMessage(text: string, isError = false) {
    setMessage(text);
    setMessageIsError(isError);
  }

  const goldenSet = useMemo(() => new Set(goldenSegmentIds), [goldenSegmentIds]);

  const routeMapLines = useMemo(() => {
    if (!result) return [];
    const lines: { id: string | number; points: [number, number][]; color?: string; dashed?: boolean; weight?: number }[] = [
      { id: "route", points: result.route.geometry },
    ];
    const hitIds =
      result.goldenHitIds ??
      result.route.segmentIds.filter((id) => goldenSet.has(id));
    for (const segmentId of hitIds) {
      const points = segmentGeometries[segmentId];
      if (points?.length) {
        lines.push({ id: `golden-${segmentId}`, points, color: "#c99a2e", dashed: true, weight: 6 });
      }
    }
    return lines;
  }, [result, goldenSet, segmentGeometries]);

  async function readApiError(res: Response): Promise<string> {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (data?.error === "no_golden_route") return t(locale, "route.noGoldenRoute");
    return t(locale, "route.noRouteFound");
  }

  function clearMessage() {
    setMessage(null);
    setMessageIsError(false);
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
    const idx = announcedStationIndexRef.current;
    if (idx >= stations.length) return;
    const station = stations[idx];
    const distance = haversineMeters(myLocation, { lat: station.lat, lng: station.lng });
    if (distance <= VOICE_ANNOUNCE_RADIUS_M) {
      announcedStationIndexRef.current = idx + 1;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const here = station.name || t(locale, "route.station");
        const next = stations[idx + 1];
        // On arrival, the useful thing to say is what's coming up next (and which
        // way), not that you've reached the station you're already standing at.
        const text = next
          ? t(locale, "route.voiceArrivedNext", {
              here,
              next: next.name || t(locale, "route.station"),
              direction: t(locale, `route.compass${compassDirection(bearing(station, next))}`),
            })
          : t(locale, "route.voiceArrivedFinal", { here });
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = locale === "de" ? "de-DE" : "en-US";
        window.speechSynthesis.speak(utterance);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLocation, voiceEnabled, mode]);

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => (a.name || `#${a.id}`).localeCompare(b.name || `#${b.id}`, locale)),
    [nodes, locale],
  );

  async function callApi(path: string, body: unknown = {}): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function toggleLocation() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setMyLocation(null);
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

  async function discover() {
    setExplorerMode(true);
    await suggest();
  }

  async function surprise() {
    setExplorerMode(false);
    setStatus("loading");
    clearMessage();
    if (!startNodeId) return;
    const res = await callApi("/api/route/generate", {
      startNodeId,
      destinationNodeId: isLoop ? startNodeId : destinationNodeId || startNodeId,
      waypointNodeId: waypointNodeId || null,
      explorerMode: false,
      forceGolden,
      preset: "surprise",
    });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
    } else {
      setResult(null);
      setStatus("error");
      flashMessage(await readApiError(res), true);
    }
  }

  async function suggest(preset?: "short" | "long") {
    if (!startNodeId) return;
    setStatus("loading");
    clearMessage();
    const res = await callApi("/api/route/generate", {
      startNodeId,
      destinationNodeId: isLoop ? startNodeId : destinationNodeId || startNodeId,
      waypointNodeId: waypointNodeId || null,
      explorerMode,
      forceGolden,
      preset,
    });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
    } else {
      setResult(null);
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
      setStatus("idle");
      clearMessage();
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
    const res = await callApi("/api/route/complete");
    if (res.ok) {
      const data = (await res.json()) as RouteCompletionData;
      setResult(null);
      setMode("suggesting");
      setStatus("idle");
      setCompletionData(data);
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

  async function handleSaveFavorite() {
    if (!result) return;
    const name = (mode === "active" ? nickname : favoriteName).trim();
    if (!name) return;
    setSavingFavorite(true);
    const res = await callApi("/api/favorites", {
      name,
      nodeChain: result.route.nodeChain,
      segmentIds: result.route.segmentIds,
      lengthM: result.route.lengthM,
      durationMin: result.route.durationMin,
    });
    setSavingFavorite(false);
    if (res.ok) {
      if (mode === "suggesting") setFavoriteName("");
      flashMessage(t(locale, "route.favoriteSaved"));
      router.refresh();
    }
  }

  async function handleTakeFavorite(favorite: FavoriteEntry) {
    setStatus("loading");
    const res = await callApi(`/api/favorites/${favorite.id}/accept`);
    if (res.ok) {
      setResult({ token: "", route: favorite.display });
      setMode("active");
      setStatus("idle");
      clearMessage();
      setNickname("");
      announcedStationIndexRef.current = 0;
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("idle");
      flashMessage(body?.error === "favorite_stale" ? t(locale, "route.favoriteStale") : t(locale, "common.error"), true);
    }
  }

  async function handleDeleteFavorite(id: number) {
    if (!window.confirm(t(locale, "route.favoriteDeleteConfirm"))) return;
    await callApi(`/api/favorites/${id}/delete`);
    router.refresh();
  }

  async function handleCopyShareLink(fav: FavoriteEntry) {
    if (!fav.shareToken) return;
    await navigator.clipboard.writeText(`${window.location.origin}/share/${fav.shareToken}`);
    flashMessage(t(locale, "route.favoriteShareCopied"));
  }

  async function handleToggleShare(fav: FavoriteEntry) {
    const res = await callApi(`/api/favorites/${fav.id}/share`, { enable: !fav.shareToken });
    if (!res.ok) return;
    const data = (await res.json()) as { shareToken: string | null };
    if (data.shareToken) {
      await navigator.clipboard.writeText(`${window.location.origin}/share/${data.shareToken}`);
      flashMessage(t(locale, "route.favoriteShareCopied"));
    } else {
      flashMessage(t(locale, "route.favoriteUnshare"));
    }
    router.refresh();
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
          <span className="chip">
            {t(locale, "route.pointPreview", { points: result.pointPreview.total })}
          </span>
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
    <div className={`route-action-bar${mode === "active" ? "" : ""}`}>
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
          <input
            type="text"
            value={favoriteName}
            onChange={(e) => setFavoriteName(e.target.value)}
            placeholder={t(locale, "route.routeNamePlaceholder")}
            style={{ maxWidth: "9rem", fontSize: "0.82rem", padding: "0.35rem 0.5rem" }}
          />
          <button type="button" className="btn-secondary btn-compact" onClick={handleSaveFavorite} disabled={savingFavorite || !favoriteName.trim()}>
            {t(locale, "route.saveFavorite")}
          </button>
        </>
      ) : (
        <>
          <button type="button" className={watchId !== null ? "btn-primary btn-compact" : "btn-secondary btn-compact"} onClick={toggleLocation}>
            {watchId !== null ? t(locale, "route.hideLocation") : t(locale, "route.showLocation")}
          </button>
          <button
            type="button"
            className={voiceEnabled ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
            onClick={() => setVoiceEnabled((v) => !v)}
            title={t(locale, "route.voiceHint")}
          >
            {voiceEnabled ? t(locale, "route.voiceOff") : t(locale, "route.voiceOn")}
          </button>
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
          <button type="button" className="btn-secondary btn-compact" onClick={handleSaveFavorite} disabled={savingFavorite || !nickname.trim()}>
            {t(locale, "route.saveFavorite")}
          </button>
        </>
      )}
    </div>
  ) : null;

  return (
    <div className={`route-shell${result ? " has-map" : ""}`}>
      {result && (
        <div className="route-map-pane">
          <MapViewLazy
            fitKey={result.token || result.route.nodeChain.join("-")}
            lines={routeMapLines}
            markers={[
              ...result.route.stations.map((s, idx) => ({
                id: `${s.nodeId}-${idx}`,
                lat: s.lat,
                lng: s.lng,
                label: s.name || `#${s.nodeId}`,
                color: idx === 0 ? "#a5711c" : "#2e6b49",
              })),
              ...(myLocation ? [{ id: "me", lat: myLocation.lat, lng: myLocation.lng, label: t(locale, "route.you"), color: "#2b6cb0" }] : []),
            ]}
            height={360}
          />
          {routeChips && <div className="route-action-bar" style={{ marginTop: "0.45rem" }}>{routeChips}</div>}
          <p className="route-stations-oneline" title={result.route.shortStationGroups.map((g) => (g.viaSegmentName ? `${g.text} (${t(locale, "route.via", { name: g.viaSegmentName })})` : g.text)).join(" › ")}>
            {result.route.shortStationGroups
              .map((g) => (g.viaSegmentName ? `${g.text} (${t(locale, "route.via", { name: g.viaSegmentName })})` : g.text))
              .join(" › ")}
          </p>
        </div>
      )}

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
        {mode === "suggesting" && favorites.length > 0 && (
          <details className="card route-panel-compact route-favorites-compact">
            <summary>{t(locale, "route.favoritesTitle")} ({favorites.length})</summary>
            <div style={{ marginTop: "0.45rem" }}>
              {favorites.map((fav) => (
                <div key={fav.id} className="route-favorite-row">
                  <span className="chip">{fav.name} · {(fav.display.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}</span>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => handleTakeFavorite(fav)} disabled={status === "loading"}>
                    {t(locale, "route.favoriteTake")}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => handleToggleShare(fav)}>
                    {fav.shareToken ? t(locale, "route.favoriteUnshare") : t(locale, "route.favoriteShare")}
                  </button>
                  {fav.shareToken && (
                    <button type="button" className="btn-secondary btn-compact" onClick={() => handleCopyShareLink(fav)}>
                      {t(locale, "route.favoriteCopyLink")}
                    </button>
                  )}
                  <button type="button" className="btn-danger btn-compact" onClick={() => handleDeleteFavorite(fav.id)}>
                    {t(locale, "map.delete")}
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}

        {mode === "suggesting" && !result && (
          <div className="card route-panel-compact">
            <form onSubmit={(e) => e.preventDefault()} className="stack" style={{ gap: "0.45rem" }}>
              <div className="field">
                <label htmlFor="startNode">{t(locale, "route.start")}</label>
                <select id="startNode" value={startNodeId} onChange={(e) => setStartNodeId(Number(e.target.value))}>
                  <option value="" disabled>…</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name || `#${n.id}`}
                      {n.isHome ? ` (${t(locale, "map.home")})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="btn-row">
                <label className="checkbox">
                  <input type="checkbox" checked={isLoop} onChange={(e) => setIsLoop(e.target.checked)} />
                  {t(locale, "route.loop")}
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={explorerMode} onChange={(e) => setExplorerMode(e.target.checked)} />
                  {t(locale, "route.explorerMode")}
                </label>
              </div>

              {!isLoop && (
                <div className="field">
                  <label htmlFor="destinationNode">{t(locale, "route.destination")}</label>
                  <select id="destinationNode" value={destinationNodeId} onChange={(e) => setDestinationNodeId(Number(e.target.value))}>
                    <option value="" disabled>…</option>
                    {sortedNodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.name || `#${n.id}`}</option>
                    ))}
                  </select>
                </div>
              )}

              <details>
                <summary style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer" }}>
                  {t(locale, "route.moreOptions")}
                </summary>
                <div className="field" style={{ marginTop: "0.35rem" }}>
                  <label htmlFor="waypointNode">{t(locale, "route.waypoint")} ({t(locale, "common.optional")})</label>
                  <select id="waypointNode" value={waypointNodeId} onChange={(e) => setWaypointNodeId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">{t(locale, "route.waypointNone")}</option>
                    {sortedNodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.name || `#${n.id}`}</option>
                    ))}
                  </select>
                </div>
                <label className="checkbox" style={{ marginTop: "0.45rem" }}>
                  <input type="checkbox" checked={forceGolden} onChange={(e) => setForceGolden(e.target.checked)} />
                  {t(locale, "route.forceGolden")}
                </label>
                <p className="hint" style={{ marginTop: "0.25rem" }}>{t(locale, "route.forceGoldenHint")}</p>
              </details>

              <div className="route-action-bar">
                <button type="button" className="btn-primary btn-compact" disabled={status === "loading" || !startNodeId} onClick={() => suggest("short")} title={t(locale, "route.presetShortHint")}>
                  {status === "loading" ? t(locale, "route.generating") : t(locale, "route.presetShort")}
                </button>
                <button type="button" className="btn-secondary btn-compact" disabled={status === "loading" || !startNodeId} onClick={() => suggest("long")} title={t(locale, "route.presetLongHint")}>
                  {t(locale, "route.presetLong")}
                </button>
                <button type="button" className="btn-secondary btn-compact" disabled={status === "loading" || !startNodeId} onClick={() => discover()} title={t(locale, "route.presetDiscoverHint")}>
                  {t(locale, "route.presetDiscover")}
                </button>
                <button type="button" className="btn-secondary btn-compact" disabled={status === "loading" || !startNodeId} onClick={() => surprise()} title={t(locale, "route.presetSurpriseHint")}>
                  {t(locale, "route.presetSurprise")}
                </button>
              </div>
            </form>
          </div>
        )}

        {mode === "active" && !result && (
          <div className="alert alert-success" style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem" }}>{t(locale, "route.activeNotice")}</div>
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
