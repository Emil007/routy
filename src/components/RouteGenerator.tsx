"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "./MapViewLazy";
import type { NodeRow } from "@/lib/nodes";

interface RouteStation {
  nodeId: number;
  name: string | null;
  lat: number;
  lng: number;
}

interface RouteDisplayPayload {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  stations: RouteStation[];
  elevation: { gainM: number; lossM: number } | null;
  geometry: [number, number][];
}

interface GenerateResponse {
  token: string;
  route: RouteDisplayPayload;
}

interface FavoriteEntry {
  id: number;
  name: string;
  display: RouteDisplayPayload;
}

export function RouteGenerator({
  locale,
  nodes,
  homeNodeId,
  initialActiveRoute,
  favorites,
}: {
  locale: Locale;
  nodes: NodeRow[];
  homeNodeId: number | null;
  initialActiveRoute: RouteDisplayPayload | null;
  favorites: FavoriteEntry[];
}) {
  const router = useRouter();
  const [startNodeId, setStartNodeId] = useState<number | "">(homeNodeId ?? "");
  const [isLoop, setIsLoop] = useState(true);
  const [destinationNodeId, setDestinationNodeId] = useState<number | "">(homeNodeId ?? "");
  const [waypointNodeId, setWaypointNodeId] = useState<number | "">("");
  const [explorerMode, setExplorerMode] = useState(false);

  const [mode, setMode] = useState<"suggesting" | "active">(initialActiveRoute ? "active" : "suggesting");
  const [result, setResult] = useState<GenerateResponse | null>(
    initialActiveRoute ? { token: "", route: initialActiveRoute } : null,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [favoriteName, setFavoriteName] = useState("");
  const [savingFavorite, setSavingFavorite] = useState(false);

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  function nodeName(id: number): string {
    return nodes.find((n) => n.id === id)?.name || `#${id}`;
  }

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

  async function handleSuggest(e: React.FormEvent) {
    e.preventDefault();
    if (!startNodeId) return;
    setStatus("loading");
    setMessage(null);
    const res = await callApi("/api/route/generate", {
      startNodeId,
      destinationNodeId: isLoop ? startNodeId : destinationNodeId || startNodeId,
      waypointNodeId: waypointNodeId || null,
      explorerMode,
    });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
    } else {
      setResult(null);
      setStatus("error");
      setMessage(t(locale, "route.noRouteFound"));
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
      setMessage(null);
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.noAlternative"));
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
      setMessage(null);
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.noAlternative"));
    }
  }

  async function handleAccept() {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/accept", { token: result.token });
    if (res.ok) {
      setMode("active");
      setStatus("idle");
      setMessage(null);
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.sessionExpired"));
    }
  }

  async function handleCancel() {
    if (!result) return;
    await callApi("/api/route/cancel", { token: result.token });
    setResult(null);
    setMessage(null);
  }

  async function handleComplete() {
    setStatus("loading");
    const res = await callApi("/api/route/complete");
    if (res.ok) {
      setResult(null);
      setMode("suggesting");
      setStatus("idle");
      setMessage(t(locale, "route.completedMessage"));
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
        setMyLocation(null);
      }
    } else {
      setStatus("idle");
      setMessage(t(locale, "common.error"));
    }
  }

  async function handleSaveFavorite() {
    if (!result || !favoriteName.trim()) return;
    setSavingFavorite(true);
    const res = await callApi("/api/favorites", {
      name: favoriteName.trim(),
      nodeChain: result.route.nodeChain,
      segmentIds: result.route.segmentIds,
      lengthM: result.route.lengthM,
      durationMin: result.route.durationMin,
    });
    setSavingFavorite(false);
    if (res.ok) {
      setFavoriteName("");
      setMessage(t(locale, "route.favoriteSaved"));
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
      setMessage(null);
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("idle");
      setMessage(body?.error === "favorite_stale" ? t(locale, "route.favoriteStale") : t(locale, "common.error"));
    }
  }

  async function handleDeleteFavorite(id: number) {
    if (!window.confirm(t(locale, "route.favoriteDeleteConfirm"))) return;
    await callApi(`/api/favorites/${id}/delete`);
    router.refresh();
  }

  async function handleDiscardActive() {
    if (!window.confirm(t(locale, "route.discardConfirm"))) return;
    setStatus("loading");
    await callApi("/api/route/discard");
    setResult(null);
    setMode("suggesting");
    setStatus("idle");
    setMessage(null);
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setMyLocation(null);
    }
  }

  return (
    <div className="stack">
      {mode === "suggesting" && favorites.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: "0.6rem" }}>{t(locale, "route.favoritesTitle")}</h3>
          <div className="stack">
            {favorites.map((fav) => (
              <div key={fav.id} className="btn-row" style={{ alignItems: "center" }}>
                <span className="chip">
                  {fav.name} — {(fav.display.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
                </span>
                <button type="button" className="btn-secondary" onClick={() => handleTakeFavorite(fav)} disabled={status === "loading"}>
                  {t(locale, "route.favoriteTake")}
                </button>
                <button type="button" className="btn-danger" onClick={() => handleDeleteFavorite(fav.id)}>
                  {t(locale, "map.delete")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "suggesting" && (
        <div className="card">
          <form onSubmit={handleSuggest} className="stack">
            <div className="field">
              <label htmlFor="startNode">{t(locale, "route.start")}</label>
              <select id="startNode" value={startNodeId} onChange={(e) => setStartNodeId(Number(e.target.value))}>
                <option value="" disabled>
                  …
                </option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name || `#${n.id}`}
                    {n.isHome ? ` (${t(locale, "map.home")})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={isLoop} onChange={(e) => setIsLoop(e.target.checked)} />
              {t(locale, "route.loop")}
            </label>

            {!isLoop && (
              <div className="field">
                <label htmlFor="destinationNode">{t(locale, "route.destination")}</label>
                <select
                  id="destinationNode"
                  value={destinationNodeId}
                  onChange={(e) => setDestinationNodeId(Number(e.target.value))}
                >
                  <option value="" disabled>
                    …
                  </option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name || `#${n.id}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label htmlFor="waypointNode">
                {t(locale, "route.waypoint")} ({t(locale, "common.optional")})
              </label>
              <select id="waypointNode" value={waypointNodeId} onChange={(e) => setWaypointNodeId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{t(locale, "route.waypointNone")}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name || `#${n.id}`}
                  </option>
                ))}
              </select>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={explorerMode} onChange={(e) => setExplorerMode(e.target.checked)} />
              {t(locale, "route.explorerMode")}
            </label>
            <p style={{ margin: "-0.4rem 0 0", fontSize: "0.8rem", color: "var(--ink-soft)" }}>
              {t(locale, "route.explorerModeHint")}
            </p>

            <button type="submit" className="btn-primary" disabled={status === "loading" || !startNodeId}>
              {status === "loading" ? t(locale, "route.generating") : t(locale, "route.suggest")}
            </button>
          </form>
        </div>
      )}

      {mode === "active" && <div className="alert alert-success">{t(locale, "route.activeNotice")}</div>}

      {message && <div className="alert alert-success">{message}</div>}

      {result && (
        <div className="card stack">
          <MapViewLazy
            lines={[{ id: "route", points: result.route.geometry }]}
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

          <div className="btn-row">
            <span className="chip">
              {t(locale, "route.distanceLabel")}: {(result.route.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
            </span>
            <span className="chip">
              {t(locale, "route.durationLabel")}: {result.route.durationMin} {t(locale, "common.min")}
            </span>
            {result.route.elevation && (
              <>
                <span className="chip">
                  ↗ {t(locale, "route.elevationGain", { gain: result.route.elevation.gainM })}
                </span>
                <span className="chip">
                  ↘ {t(locale, "route.elevationLoss", { loss: result.route.elevation.lossM })}
                </span>
              </>
            )}
          </div>

          <div>
            <strong style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "route.stationList")}</strong>
            <p style={{ marginTop: "0.3rem" }}>
              {result.route.stations.map((s) => s.name || nodeName(s.nodeId)).join(" › ")}
            </p>
          </div>

          <div className="btn-row">
            {mode === "suggesting" ? (
              <>
                <button type="button" className="btn-secondary" onClick={() => handleAdjust("shorter")} disabled={status === "loading"}>
                  {t(locale, "route.shorter")}
                </button>
                <button type="button" className="btn-secondary" onClick={() => handleAdjust("longer")} disabled={status === "loading"}>
                  {t(locale, "route.longer")}
                </button>
                <button type="button" className="btn-secondary" onClick={handleAnother} disabled={status === "loading"}>
                  {t(locale, "route.newRoute")}
                </button>
                <button type="button" className="btn-primary" onClick={handleAccept} disabled={status === "loading"}>
                  {t(locale, "route.accept")}
                </button>
                <button type="button" className="btn-danger" onClick={handleCancel} disabled={status === "loading"}>
                  {t(locale, "route.cancel")}
                </button>
                <input
                  type="text"
                  value={favoriteName}
                  onChange={(e) => setFavoriteName(e.target.value)}
                  placeholder={t(locale, "route.favoriteNamePlaceholder")}
                  style={{ maxWidth: "12rem" }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSaveFavorite}
                  disabled={savingFavorite || !favoriteName.trim()}
                >
                  {t(locale, "route.saveFavorite")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className={watchId !== null ? "btn-primary" : "btn-secondary"} onClick={toggleLocation}>
                  {watchId !== null ? t(locale, "route.hideLocation") : t(locale, "route.showLocation")}
                </button>
                <button type="button" className="btn-primary" onClick={handleComplete} disabled={status === "loading"}>
                  {t(locale, "route.completeButton")}
                </button>
                <button type="button" className="btn-danger" onClick={handleDiscardActive} disabled={status === "loading"}>
                  {t(locale, "route.discardButton")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
