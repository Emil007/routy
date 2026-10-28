"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { haversineMeters, pathLengthMeters, type LatLng } from "@/lib/geo";
import { MapViewLazy } from "./MapViewLazy";
import type { MapLayerSink } from "@/lib/mapLayerSink";
import type { MapMarker, MapLine, MapCircle, MapViewState } from "./MapView";
import type { NodeRow } from "@/lib/nodes";
import { useMapShell } from "./map-shell/MapShellContext";

interface ReachableNeighbour {
  nodeId: number;
  name: string | null;
  distanceM: number;
  viaSegmentName: string | null;
}

interface ReachedNode {
  nodeId: number;
  name: string | null;
  reachable: ReachableNeighbour[];
}

interface StartResponse {
  token: string;
  startNodeId: number | null;
  startReachable: ReachableNeighbour[];
  /** 0.57: lokalisierte Start-Ansage („Angekommen bei … mögliche Wege zu…“). */
  announcement: string | null;
  freeRoam: boolean;
  pointsMultiplier: number | null;
}

interface CheckinResponse {
  ok: boolean;
  newlyReached: ReachedNode[];
  shouldAnnounce: boolean;
  /** 0.57: vollständiger, lokalisierter Ansage-Text vom Server. */
  announcement: string | null;
  visitedCount: number;
  /** Rotation token (stateless sessions, decision K): MUST replace the stored one. */
  token: string;
}

export function FreeRoamCard({
  locale,
  nodes,
  networkLines,
  walkSpeedKmh = 5,
  initialView,
  onViewChange,
  hosted = false,
  onLayersChange,
}: {
  locale: Locale;
  nodes: NodeRow[];
  networkLines: MapLine[];
  walkSpeedKmh?: number;
  initialView?: MapViewState;
  onViewChange?: (view: MapViewState) => void;
  /** Host-betrieb (§4.5): keine eigene Karte, nur Overlay nach oben. */
  hosted?: boolean;
  onLayersChange?: (layers: MapLayerSink) => void;
}) {
  const router = useRouter();
  const { setLive, registerLiveStop } = useMapShell();
  const [phase, setPhase] = useState<"idle" | "roaming">("idle");
  const [token, setToken] = useState<string | null>(null);
  const [startNodeId, setStartNodeId] = useState<number | null>(null);
  const [track, setTrack] = useState<LatLng[]>([]);
  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [reached, setReached] = useState<ReachedNode[]>([]);
  // 0.57: vollstaendige, lokalisierte Ansage vom Server ("Angekommen bei ... Richtung ...").
  const [announceText, setAnnounceText] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const isRoamingRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const lastCheckinRef = useRef<{ lat: number; lng: number } | null>(null);
  // Monotonic guard: only the LATEST checkin response may rotate the token.
  // Promises can resolve out of order, so an older response must not clobber a
  // newer rotated token (stateless HMAC tokens differ per checkin, decision K).
  const checkinSeqRef = useRef(0);

  useEffect(() => {
    isRoamingRef.current = phase === "roaming";
  }, [phase]);

  // §7.2/H2: Freies Gehen gilt solange als Live-Sitzung, wie geraden ein GPS-Watch
  // läuft. Beim Wechsel in einen anderen Modus über den Dock bestätigt der Nutzer,
  // dann stoppt der registrierte Handler über stopRoaming (Watch aus + Reset).
  const stopRoamingRef = useRef(stopRoaming);
  useEffect(() => {
    stopRoamingRef.current = stopRoaming;
  }, [stopRoaming]);
  useEffect(() => {
    setLive("freeRoam", phase === "roaming");
  }, [phase, setLive]);
  useEffect(() => {
    registerLiveStop("freeRoam", () => stopRoamingRef.current());
    return () => {
      registerLiveStop("freeRoam", null);
      setLive("freeRoam", false);
    };
  }, [registerLiveStop, setLive]);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  const lengthM = useMemo(() => Math.round(pathLengthMeters(track)), [track]);

  const nodeMarkers: MapMarker[] = useMemo(() => {
    const reachedIds = new Set(reached.map((r) => r.nodeId));
    const startMarkers: MapMarker[] = [];
    for (const n of nodes) {
      if (startNodeId != null && n.id === startNodeId) {
        startMarkers.push({ id: `start-${n.id}`, lat: n.lat, lng: n.lng, label: "●", color: "#a5711c" });
        continue;
      }
      if (reachedIds.has(n.id)) {
        startMarkers.push({ id: `done-${n.id}`, lat: n.lat, lng: n.lng, label: "✓", color: "#2e6b49" });
        continue;
      }
    }
    return startMarkers;
  }, [nodes, reached, startNodeId]);

  const trackLine: MapLine[] = useMemo(
    () => (track.length > 1 ? [{ id: "track", points: track.map((p): [number, number] => [p.lat, p.lng]), color: "#9a3b29", weight: 4 }] : []),
    [track],
  );
  const myMarker: MapMarker[] = useMemo(
    () => (currentPos ? [{ id: "me", lat: currentPos.lat, lng: currentPos.lng, color: "#2b6cb0" }] : []),
    [currentPos],
  );
  const reachCircles: MapCircle[] = useMemo(() => {
    const circles: MapCircle[] = [];
    for (const r of reached) {
      const node = nodes.find((n) => n.id === r.nodeId);
      if (node) circles.push({ id: `circ-${r.nodeId}`, lat: node.lat, lng: node.lng, radiusM: 30, color: "#2e6b49" });
    }
    return circles;
  }, [reached, nodes]);

  // Host-betrieb: Layer nach oben melden, keine eigene Karte (§4.5). Kein fitKey —
  // die Kamera bleibt während des freien Gehens unberührt (User-Feedback 0.57).
  const hostedLayers = useMemo(
    () => ({
      markers: [...nodeMarkers, ...myMarker],
      lines: [...networkLines, ...trackLine],
      circles: reachCircles,
    }),
    [nodeMarkers, myMarker, networkLines, trackLine, reachCircles, track.length],
  );
  useEffect(() => {
    if (hosted && onLayersChange) onLayersChange(hostedLayers);
  }, [hosted, onLayersChange, hostedLayers]);

  // 0.57: Sobald eine lokalisierte Free-Roam-Ansage vom Server kommt, laut
  // vorlesen (Paritüt mit Android VoiceGuidance).
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!announceText || announceText === lastSpokenRef.current) return;
    lastSpokenRef.current = announceText;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(announceText);
      u.lang = locale === "de" ? "de-DE" : "en-US";
      window.speechSynthesis.speak(u);
    }
  }, [announceText, locale]);

  async function startRoaming() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(t(locale, "route.freeRoamLocationError"));
      setStatus("error");
      return;
    }
    setStatus("starting");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const start = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          const res = await fetch("/api/route/free-roam/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: start.lat, lng: start.lng }),
          });
          if (!res.ok) {
            setStatus("error");
            setMessage(t(locale, "common.error"));
            return;
          }
          const data = (await res.json()) as StartResponse;
          setToken(data.token);
          setStartNodeId(data.startNodeId);
          setReached(
            data.startReachable.length > 0
              ? [{ nodeId: data.startNodeId!, name: nodes.find((n) => n.id === data.startNodeId)?.name ?? null, reachable: data.startReachable }]
              : [],
          );
          setAnnounceText(data.announcement);
          setTrack([start]);
          setCurrentPos(start);
          setPhase("roaming");
          setStatus("idle");
          if (data.startNodeId == null) {
            setMessage(t(locale, "route.freeRoamNoStartNode"));
            setStatus("idle");
          }
        } catch {
          setStatus("error");
          setMessage(t(locale, "route.connectionFailed"));
        }
      },
      () => {
        setStatus("error");
        setMessage(t(locale, "route.freeRoamLocationError"));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }

  function stopRoaming() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    setPhase("idle");
    setToken(null);
    setStartNodeId(null);
    setTrack([]);
    setCurrentPos(null);
    setReached([]);
    setAnnounceText(null);
  }

  // M5-2: manueller Stopp fragt erst — der Dock-Stopp hat den Dialog schon selbst
  // (registered live-stop ruft stopRoaming direkt, das bleibt bestätigt).
  function requestStopRoaming() {
    if (!window.confirm(t(locale, "route.freeRoamStopConfirm"))) return;
    stopRoaming();
  }

  async function doCheckin(pos: LatLng) {
    const tkn = tokenRef.current;
    if (!tkn) return;
    const last = lastCheckinRef.current;
    if (last && haversineMeters(last, pos) < 10) return; // not moved enough
    // Sequence this request: any earlier in-flight response must be ignored when
    // it lands (it would carry a token older than a later checkin's rotation).
    const seq = ++checkinSeqRef.current;
    try {
      const res = await fetch("/api/route/free-roam/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tkn, lat: pos.lat, lng: pos.lng }),
      });
      if (!res.ok) return;
      // M5-1: der Cursor rückt erst nach OK vor — ein Fehlschlag wird bei der
      // nächsten Bewegung erneut versucht statt den Eintritt dauerhaft zu verpassen.
      if (!isRoamingRef.current) return;
      lastCheckinRef.current = pos;
      const data = (await res.json()) as CheckinResponse;
      // Stateless token rotation (decision K): keep the latest signed token.
      if (data.token && seq === checkinSeqRef.current) {
        setToken(data.token);
        tokenRef.current = data.token;
      }
      if (seq === checkinSeqRef.current && data.newlyReached.length > 0) {
        setReached((prev) => [...prev.filter((r) => !data.newlyReached.some((n) => n.nodeId === r.nodeId)), ...data.newlyReached]);
      }
      // 0.57: lokalisierte Checkin-Ansage (einmal) setzen → unten vorlesen + anzeigen.
      if (seq === checkinSeqRef.current && data.announcement) {
        setAnnounceText(data.announcement);
      }
    } catch {
      // transient network issue — next checkin retries
    }
  }

  async function finishRoaming() {
    const tkn = tokenRef.current;
    if (!tkn) return;
    if (track.length < 2) {
      setMessage(t(locale, "draw.pointsTooFew"));
      setStatus("error");
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/route/free-roam/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tkn,
          trackPoints: track.map((p) => ({ lat: p.lat, lng: p.lng })),
          lengthM,
          nickname: null,
        }),
      });
      if (!res.ok) {
        setStatus("error");
        // M5-2: 429 zeigt die Wartezeit; Session/Track bleiben für den Retry.
        const body = (await res.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null;
        if (body?.error === "rate_limited" && body.retryAfterSeconds != null) {
          setMessage(t(locale, "route.freeRoamRateLimited", { seconds: body.retryAfterSeconds }));
        } else {
          setMessage(t(locale, "common.error"));
        }
        return;
      }
      const data = (await res.json().catch(() => null)) as { pointsEarned?: number } | null;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setPhase("idle");
      setToken(null);
      setStartNodeId(null);
      setTrack([]);
      setCurrentPos(null);
      setReached([]);
      setAnnounceText(null);
      setStatus("idle");
      setMessage(
        data?.pointsEarned != null
          ? t(locale, "route.freeRoamDonePoints", { points: data.pointsEarned })
          : t(locale, "route.freeRoamDone"),
      );
      router.refresh();
    } catch {
      setStatus("error");
      setMessage(t(locale, "route.connectionFailed"));
    }
  }

  useEffect(() => {
    if (phase !== "roaming" || watchId !== null) return;
    // Begin location watch once while roaming; each fix appends + throttles checkin.
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentPos(next);
        if (!isRoamingRef.current) return;
        setTrack((prev) => {
          const last = prev[prev.length - 1];
          if (last && haversineMeters(last, next) < 4) return prev;
          return [...prev, next];
        });
        void doCheckin(next);
      },
      () => {
        setMessage(t(locale, "route.freeRoamLocationError"));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    setWatchId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="card stack" style={{ gap: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>{t(locale, "route.freeRoamStart")}</strong>
        <span className="chip" style={{ fontSize: "0.72rem" }}>{t(locale, "route.freeRoamPointsHint")}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" }}>
        {t(locale, "route.freeRoamStartHint")}
      </p>

      {phase === "idle" && (
        <div className="route-action-bar">
          <button type="button" className="btn-primary btn-compact" onClick={startRoaming} disabled={status === "starting"}>
            {status === "starting" ? t(locale, "common.loading") : t(locale, "route.freeRoamTrackStart")}
          </button>
        </div>
      )}

      {phase === "roaming" && (
        <>
          {!hosted && (
            <MapViewLazy
              locale={locale}
              height={360}
              autoFit={false}
              lines={[...networkLines, ...trackLine]}
              markers={[...nodeMarkers, ...myMarker]}
              circles={reachCircles}
              initialView={initialView}
              onViewChange={onViewChange}
              fitKey={`roam-${track.length}`}
            />
          )}
          <div className="record-map-bar">
            <span className="chip">{t(locale, "route.freeRoamActive")}</span>
            <span className="chip">{t(locale, "draw.distanceSoFar")}: {(lengthM / 1000).toFixed(2)} {t(locale, "common.km")}</span>
            <span className="chip">{t(locale, "route.freeRoamReachable")}: {reached.length}</span>
          </div>
          {reached.length > 0 && (
            <div className="stack" style={{ gap: "0.25rem" }}>
              {announceText && (
                <p className="hint-compact" style={{ margin: 0, fontSize: "0.8rem" }}>
                  {announceText}
                </p>
              )}
              {reached.map((r) => (
                <div key={r.nodeId} className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                  <span className="chip" style={{ backgroundColor: "var(--ok, #2e6b49)", color: "#fff" }}>
                    ✓ {r.name ?? `#${r.nodeId}`}
                  </span>
                  {r.reachable.map((nb) => (
                    <span key={`${r.nodeId}-${nb.nodeId}`} className="chip">
                      {nb.name ?? `#${nb.nodeId}`}
                      {nb.viaSegmentName ? ` · ${t(locale, "route.freeRoamVia", { via: nb.viaSegmentName })}` : ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="route-action-bar">
            <button type="button" className="btn-primary btn-compact" onClick={finishRoaming} disabled={status === "saving"}>
              {status === "saving" ? t(locale, "common.loading") : t(locale, "route.freeRoamCompleteTitle")}
            </button>
            <button type="button" className="btn-danger btn-compact" onClick={requestStopRoaming}>
              {t(locale, "route.freeRoamStop")}
            </button>
          </div>
        </>
      )}

      {message && (
        <div className={status === "error" ? "alert alert-error" : "alert alert-success"} style={{ padding: "0.45rem 0.65rem", fontSize: "0.8rem" }}>
          {message}
        </div>
      )}
    </div>
  );
}
