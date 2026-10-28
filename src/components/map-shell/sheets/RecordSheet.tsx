"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, estimateMinutes, haversineMeters, type LatLng } from "@/lib/geo";
import { findNodeCandidates } from "@/lib/nodeMatching";
import { EndpointFields } from "@/components/EndpointFields";
import type { NodeRow } from "@/lib/nodes";
import type { MapLine, MapMarker } from "@/components/MapView";
import type { MapLayerSink } from "@/lib/mapLayerSink";
import { useMapShell } from "../MapShellContext";

interface EndpointDecision {
  choice: "existing" | "new";
  nodeId: number | null;
  part1: string;
  part2: string;
}

function initialEndpointDecision(point: LatLng, nodes: NodeRow[], radiusM: number): EndpointDecision {
  const candidates = findNodeCandidates(nodes, point, radiusM);
  if (candidates.length > 0) return { choice: "existing", nodeId: candidates[0].id, part1: "", part2: "" };
  return { choice: "new", nodeId: null, part1: "", part2: "" };
}

/**
 * Aufnahme — Sheet-Stufe der Hülle (J4). Drei Phasen aus RecordTrackWizard ohne
 * Nav-Push und ohne eigene Karte: IDLE (Start + eine Zeile Hintergrund-Hinweis),
 * RECORDING/PAUSED (Punkte, km, Pause, Stopp, Verwerfen nur in Pause), CONFIRM
 * (Endpunkte, Speichern, Verwerfen). Die eine Karte liegt in MapCanvas — dieser
 * Sheet schreibt nur Layer nach oben (keine zweite Leaflet-Welt, §7.4).
 *
 * Web-Regel §J4: Verlassen des Modus Confirm → Unmount, Watch aus, keine Pille.
 * (Während RECORDING/PAUSED gilt dieselbe Web-Regel; Android hält den Dienst.)
 */
export function RecordSheet({
  locale,
  nodes,
  networkLines,
  mergeRadiusM,
  walkSpeedKmh,
  homeNodeId,
}: {
  locale: Locale;
  nodes: NodeRow[];
  networkLines: MapLine[];
  mergeRadiusM: number;
  walkSpeedKmh: number;
  /** M38: per-account home node — home markers use this, not the legacy nodes.is_home flag. */
  homeNodeId: number | null;
}) {
  const router = useRouter();
  const { mode, setMode, registerLayers, setLive, registerLiveStop } = useMapShell();
  const [phase, setPhase] = useState<"idle" | "recording" | "paused" | "confirm">("idle");
  const [points, setPoints] = useState<LatLng[]>([]);
  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [startDecision, setStartDecision] = useState<EndpointDecision | null>(null);
  const [endDecision, setEndDecision] = useState<EndpointDecision | null>(null);
  const [markStartAsHome, setMarkStartAsHome] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = phase === "recording";
  }, [phase]);

  // §7.2/H2: Live-Sitzung nach oben melden + Stopp-Handler registrieren. Die Aufnahme
  // ist live, solange ein GPS-Watch läuft (RECORDING/PAUSED). CONFIRM hat keinen Watch
  // mehr (§J4 Web-Regel) — der Wechsel aus CONFIRM braucht keine Bestätigung. Der
  // registrierte Stopp läuft über stop(): Watch aus, Punkte bleiben im CONFIRM erhalten.
  const stopFnRef = useRef(stop);
  useEffect(() => {
    stopFnRef.current = stop;
  }, [stop]);
  useEffect(() => {
    setLive("record", phase === "recording" || phase === "paused");
  }, [phase, setLive]);
  useEffect(() => {
    registerLiveStop("record", () => stopFnRef.current());
    return () => registerLiveStop("record", null);
  }, [registerLiveStop]);

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  const lengthM = useMemo(() => Math.round(pathLengthMeters(points)), [points]);

  const nodeMarkers: MapMarker[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        label: n.name || `#${n.id}`,
        color: n.id === homeNodeId ? "#a5711c" : "#2e6b49",
      })),
    [nodes, homeNodeId],
  );
  const trackLine: MapLine[] = useMemo(
    () => (points.length > 1 ? [{ id: "track", points: points.map((p): [number, number] => [p.lat, p.lng]), color: "#9a3b29", weight: 4 }] : []),
    [points],
  );
  const liveMarkers: MapMarker[] = useMemo(
    () => (currentPos ? [{ id: "me", lat: currentPos.lat, lng: currentPos.lng, color: "#2b6cb0" }] : []),
    [currentPos],
  );

  // Host-betrieb: Layer nach oben melden, keine eigene Karte (§4.5). Kein fitKey —
  // die Kamera bleibt während der Aufnahme unberührt (User-Feedback 0.57).
  const hostedLayers = useMemo(() => {
    const sink: MapLayerSink = {
      markers: [...nodeMarkers, ...liveMarkers],
      lines: [...networkLines, ...trackLine],
    };
    return sink;
  }, [nodeMarkers, liveMarkers, networkLines, trackLine]);
  useEffect(() => {
    if (mode === "record") registerLayers(hostedLayers);
  }, [mode, registerLayers, hostedLayers]);

  function start() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocationError(false);
    setPhase("recording");
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentPos(next);
        if (!isRecordingRef.current) return;
        setPoints((prev) => {
          const last = prev[prev.length - 1];
          if (last && haversineMeters(last, next) < 3) return prev;
          return [...prev, next];
        });
      },
      () => setLocationError(true),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    setWatchId(id);
  }

  function pause() {
    setPhase("paused");
  }

  function resume() {
    setPhase("recording");
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    if (points.length < 2) {
      setPhase("idle");
      setPoints([]);
      return;
    }
    setStartDecision(initialEndpointDecision(points[0], nodes, mergeRadiusM));
    setEndDecision(initialEndpointDecision(points[points.length - 1], nodes, mergeRadiusM));
    setPhase("confirm");
  }

  function discard() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    setPoints([]);
    setPhase("idle");
  }

  async function save() {
    if (!startDecision || !endDecision) return;
    setStatus("saving");
    setMessage(null);

    const durationMin = estimateMinutes(lengthM, walkSpeedKmh);
    const track = {
      points: points.map((p) => ({ lat: p.lat, lng: p.lng })),
      lengthM,
      durationMin,
      elevation: null,
      markStartAsHome,
      source: "gpx" as const,
      start:
        startDecision.choice === "existing" && startDecision.nodeId
          ? { nodeId: startDecision.nodeId }
          : { part1: startDecision.part1, part2: startDecision.part2 },
      end:
        endDecision.choice === "existing" && endDecision.nodeId
          ? { nodeId: endDecision.nodeId }
          : { part1: endDecision.part1, part2: endDecision.part2 },
    };

    const res = await fetch("/api/gpx/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: [track] }),
    });

    if (res.ok) {
      setMessage(t(locale, "draw.success"));
      setPoints([]);
      setStartDecision(null);
      setEndDecision(null);
      setMarkStartAsHome(false);
      setPhase("idle");
      setStatus("idle");
      // Speichern → bestehender Commit-Pfad, dann zurück auf Erkunden (§J4).
      router.refresh();
      registerLayers(null);
      setMode("explore");
    } else {
      setStatus("error");
      setMessage(t(locale, "common.error"));
    }
  }

  return (
    <div className="record-shell">
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", margin: 0 }}>{t(locale, "record.instructions")}</p>

      <div className="record-map-bar">
        <span className="chip">{t(locale, "draw.pointsSoFar", { count: points.length })}</span>
        <span className="chip">
          {t(locale, "draw.distanceSoFar")}: {(lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
        </span>
        {locationError && <span className="chip" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{t(locale, "record.locationError")}</span>}

        {phase === "idle" && (
          <button type="button" className="btn-primary btn-compact" onClick={start}>
            {t(locale, "record.start")}
          </button>
        )}
        {phase === "recording" && (
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={pause}>{t(locale, "record.pause")}</button>
            <button type="button" className="btn-primary btn-compact" onClick={stop}>{t(locale, "record.stop")}</button>
          </>
        )}
        {phase === "paused" && (
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={resume}>{t(locale, "record.resume")}</button>
            <button type="button" className="btn-primary btn-compact" onClick={stop}>{t(locale, "record.stop")}</button>
            <button type="button" className="btn-danger btn-compact" onClick={discard}>{t(locale, "record.discard")}</button>
          </>
        )}
      </div>

      {message && <div className={status === "error" ? "alert alert-error" : "alert alert-success"} style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem" }}>{message}</div>}

      {phase === "confirm" && startDecision && endDecision && (
        <div className="card route-panel-compact stack" style={{ gap: "0.45rem" }}>
          <strong style={{ fontSize: "0.85rem" }}>{t(locale, "draw.confirmTitle")}</strong>
          <div className="record-confirm-grid">
            <EndpointFields
              locale={locale}
              role="start"
              point={points[0]}
              candidates={findNodeCandidates(nodes, points[0], mergeRadiusM)}
              nameConflict={null}
              decisionChoice={startDecision.choice}
              decisionNodeId={startDecision.nodeId}
              decisionPart1={startDecision.part1}
              decisionPart2={startDecision.part2}
              onChoice={(v) => setStartDecision((d) => (d ? { ...d, choice: v } : d))}
              onNodeId={(v) => setStartDecision((d) => (d ? { ...d, nodeId: v } : d))}
              onPart1={(v) => setStartDecision((d) => (d ? { ...d, part1: v } : d))}
              onPart2={(v) => setStartDecision((d) => (d ? { ...d, part2: v } : d))}
            />
            <EndpointFields
              locale={locale}
              role="end"
              point={points[points.length - 1]}
              candidates={findNodeCandidates(nodes, points[points.length - 1], mergeRadiusM)}
              nameConflict={null}
              decisionChoice={endDecision.choice}
              decisionNodeId={endDecision.nodeId}
              decisionPart1={endDecision.part1}
              decisionPart2={endDecision.part2}
              onChoice={(v) => setEndDecision((d) => (d ? { ...d, choice: v } : d))}
              onNodeId={(v) => setEndDecision((d) => (d ? { ...d, nodeId: v } : d))}
              onPart1={(v) => setEndDecision((d) => (d ? { ...d, part1: v } : d))}
              onPart2={(v) => setEndDecision((d) => (d ? { ...d, part2: v } : d))}
            />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={markStartAsHome} onChange={(e) => setMarkStartAsHome(e.target.checked)} />
            {t(locale, "import.markAsHome")}
          </label>
          <div className="route-action-bar">
            <button type="button" className="btn-primary btn-compact" onClick={save} disabled={status === "saving"}>
              {status === "saving" ? t(locale, "draw.saving") : t(locale, "draw.save")}
            </button>
            <button type="button" className="btn-danger btn-compact" onClick={discard} disabled={status === "saving"}>
              {t(locale, "record.discard")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
