"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, estimateMinutes, haversineMeters, type LatLng } from "@/lib/geo";
import { findNodeCandidates } from "@/lib/nodeMatching";
import { MapViewLazy } from "./MapViewLazy";
import { EndpointFields } from "./EndpointFields";
import type { NodeRow } from "@/lib/nodes";
import type { MapMarker, MapLine, MapViewState } from "./MapView";

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
 * Live GPS recording, built on the same watchPosition pattern as
 * RouteGenerator's "show my location" toggle — but accumulating points into a
 * track instead of just showing a dot. Only works while the tab/screen stays
 * open (no reliable background-geolocation API in browsers), which the UI
 * copy says plainly rather than overselling it.
 */
export function RecordTrackWizard({
  locale,
  nodes,
  networkLines,
  mergeRadiusM,
  walkSpeedKmh,
  initialView,
  onViewChange,
}: {
  locale: Locale;
  nodes: NodeRow[];
  networkLines: MapLine[];
  mergeRadiusM: number;
  walkSpeedKmh: number;
  initialView?: MapViewState;
  onViewChange?: (view: MapViewState) => void;
}) {
  const router = useRouter();
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

  useEffect(() => {
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  const lengthM = useMemo(() => Math.round(pathLengthMeters(points)), [points]);

  const nodeMarkers: MapMarker[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, label: n.name || `#${n.id}`, color: n.isHome ? "#a5711c" : "#2e6b49" })),
    [nodes],
  );
  const trackLine: MapLine[] = useMemo(
    () => (points.length > 1 ? [{ id: "track", points: points.map((p): [number, number] => [p.lat, p.lng]), color: "#9a3b29", weight: 4 }] : []),
    [points],
  );
  const liveMarkers: MapMarker[] = useMemo(
    () => (currentPos ? [{ id: "me", lat: currentPos.lat, lng: currentPos.lng, color: "#2b6cb0" }] : []),
    [currentPos],
  );

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
      router.refresh();
    } else {
      setStatus("error");
      setMessage(t(locale, "common.error"));
    }
  }

  return (
    <div className="record-shell">
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", margin: 0 }}>{t(locale, "record.instructions")}</p>

      <MapViewLazy
        locale={locale}
        height={420}
        autoFit={false}
        lines={[...networkLines, ...trackLine]}
        markers={[...nodeMarkers, ...liveMarkers]}
        initialView={initialView}
        onViewChange={onViewChange}
      />

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
          </div>
        </div>
      )}
    </div>
  );
}
