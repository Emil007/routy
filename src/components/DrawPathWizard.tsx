"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, estimateMinutes, haversineMeters, type LatLng } from "@/lib/geo";
import { findNodeCandidates } from "@/lib/nodeMatching";
import { MapViewLazy } from "./MapViewLazy";
import { EndpointFields } from "./EndpointFields";
import type { NodeRow } from "@/lib/nodes";
import type { MapMarker, MapLine, MapCircle } from "./MapView";

interface DrawPoint extends LatLng {
  snappedNodeId: number | null;
}

interface EndpointDecision {
  choice: "existing" | "new";
  nodeId: number | null;
  newName: string;
}

function initialEndpointDecision(point: DrawPoint, nodes: NodeRow[], radiusM: number): EndpointDecision {
  if (point.snappedNodeId !== null) {
    return { choice: "existing", nodeId: point.snappedNodeId, newName: "" };
  }
  const candidates = findNodeCandidates(nodes, point, radiusM);
  if (candidates.length > 0) return { choice: "existing", nodeId: candidates[0].id, newName: "" };
  return { choice: "new", nodeId: null, newName: "" };
}

export function DrawPathWizard({
  locale,
  nodes,
  networkLines,
  mergeRadiusM,
  walkSpeedKmh,
}: {
  locale: Locale;
  nodes: NodeRow[];
  networkLines: MapLine[];
  mergeRadiusM: number;
  walkSpeedKmh: number;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<DrawPoint[]>([]);
  const [phase, setPhase] = useState<"drawing" | "confirm">("drawing");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [startDecision, setStartDecision] = useState<EndpointDecision | null>(null);
  const [endDecision, setEndDecision] = useState<EndpointDecision | null>(null);
  const [markStartAsHome, setMarkStartAsHome] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const lengthM = useMemo(() => Math.round(pathLengthMeters(points)), [points]);

  const nodeMarkers: MapMarker[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, label: n.name || `#${n.id}`, color: n.isHome ? "#a5711c" : "#2e6b49" })),
    [nodes],
  );
  const nodeCircles: MapCircle[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, radiusM: mergeRadiusM })),
    [nodes, mergeRadiusM],
  );
  const draftLine: MapLine[] = useMemo(
    () => (points.length > 1 ? [{ id: "draft", points: points.map((p): [number, number] => [p.lat, p.lng]), color: "#9a3b29", weight: 4 }] : []),
    [points],
  );
  const draftMarkers: MapMarker[] = useMemo(
    () => points.map((p, i) => ({ id: `draft-${i}`, lat: p.lat, lng: p.lng, color: "#9a3b29", draggable: phase === "drawing" })),
    [points, phase],
  );

  function addPoint(lat: number, lng: number, snappedNodeId: number | null) {
    setPoints((prev) => {
      const last = prev[prev.length - 1];
      const candidate = { lat, lng, snappedNodeId };
      if (last && haversineMeters(last, candidate) < 1) return prev;
      return [...prev, candidate];
    });
  }

  function handleMapClick(lat: number, lng: number) {
    if (phase !== "drawing") return;
    if (snapEnabled) {
      const snap = findNodeCandidates(nodes, { lat, lng }, mergeRadiusM)[0];
      if (snap) {
        addPoint(snap.lat, snap.lng, snap.id);
        return;
      }
    }
    addPoint(lat, lng, null);
  }

  function handleMarkerClick(id: number | string) {
    if (phase !== "drawing" || typeof id !== "number") return;
    const node = nodes.find((n) => n.id === id);
    if (node) addPoint(node.lat, node.lng, node.id);
  }

  function handleDraftDragEnd(id: number | string, lat: number, lng: number) {
    if (phase !== "drawing" || typeof id !== "string" || !id.startsWith("draft-")) return;
    const index = Number(id.slice("draft-".length));
    setPoints((prev) => {
      const next = [...prev];
      const snap = snapEnabled ? findNodeCandidates(nodes, { lat, lng }, mergeRadiusM)[0] : undefined;
      next[index] = snap ? { lat: snap.lat, lng: snap.lng, snappedNodeId: snap.id } : { lat, lng, snappedNodeId: null };
      return next;
    });
  }

  function undo() {
    setPoints((prev) => prev.slice(0, -1));
  }

  function clear() {
    setPoints([]);
  }

  function finish() {
    if (points.length < 2) return;
    setStartDecision(initialEndpointDecision(points[0], nodes, mergeRadiusM));
    setEndDecision(initialEndpointDecision(points[points.length - 1], nodes, mergeRadiusM));
    setPhase("confirm");
  }

  function backToDrawing() {
    setPhase("drawing");
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
      source: "drawn" as const,
      start:
        startDecision.choice === "existing" && startDecision.nodeId
          ? { nodeId: startDecision.nodeId }
          : { newName: startDecision.newName || null },
      end:
        endDecision.choice === "existing" && endDecision.nodeId
          ? { nodeId: endDecision.nodeId }
          : { newName: endDecision.newName || null },
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
      setPhase("drawing");
      setStatus("idle");
      router.refresh();
    } else {
      setStatus("error");
      setMessage(t(locale, "common.error"));
    }
  }

  return (
    <div className="stack">
      <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem" }}>{t(locale, "draw.instructions")}</p>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem" }}>{t(locale, "draw.dragHint")}</p>

      <div className="card stack">
        <MapViewLazy
          height={420}
          autoFit={false}
          lines={[...networkLines, ...draftLine]}
          markers={[...nodeMarkers, ...draftMarkers]}
          circles={phase === "drawing" && snapEnabled ? nodeCircles : []}
          onMapClick={phase === "drawing" ? handleMapClick : undefined}
          onMarkerClick={phase === "drawing" ? handleMarkerClick : undefined}
          onMarkerDragEnd={phase === "drawing" ? handleDraftDragEnd : undefined}
        />

        <div className="btn-row">
          <span className="chip">{t(locale, "draw.pointsSoFar", { count: points.length })}</span>
          <span className="chip">
            {t(locale, "draw.distanceSoFar")}: {(lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
          </span>
        </div>

        {phase === "drawing" ? (
          <div className="btn-row">
            <label className="checkbox">
              <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
              {t(locale, "draw.snapToggle")}
            </label>
          </div>
        ) : null}

        {phase === "drawing" ? (
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={undo} disabled={points.length === 0}>
              {t(locale, "draw.undo")}
            </button>
            <button type="button" className="btn-secondary" onClick={clear} disabled={points.length === 0}>
              {t(locale, "draw.clear")}
            </button>
            <button type="button" className="btn-primary" onClick={finish} disabled={points.length < 2}>
              {t(locale, "draw.finish")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-secondary" onClick={backToDrawing}>
            {t(locale, "draw.backToDrawing")}
          </button>
        )}
      </div>

      {message && <div className={status === "error" ? "alert alert-error" : "alert alert-success"}>{message}</div>}

      {phase === "confirm" && startDecision && endDecision && (
        <div className="card stack">
          <h3 style={{ fontSize: "1rem" }}>{t(locale, "draw.confirmTitle")}</h3>

          <EndpointFields
            locale={locale}
            role="start"
            candidates={findNodeCandidates(nodes, points[0], mergeRadiusM)}
            nameConflict={null}
            decisionChoice={startDecision.choice}
            decisionNodeId={startDecision.nodeId}
            decisionNewName={startDecision.newName}
            onChoice={(v) => setStartDecision((d) => (d ? { ...d, choice: v } : d))}
            onNodeId={(v) => setStartDecision((d) => (d ? { ...d, nodeId: v } : d))}
            onNewName={(v) => setStartDecision((d) => (d ? { ...d, newName: v } : d))}
          />
          <label className="checkbox">
            <input type="checkbox" checked={markStartAsHome} onChange={(e) => setMarkStartAsHome(e.target.checked)} />
            {t(locale, "import.markAsHome")}
          </label>

          <EndpointFields
            locale={locale}
            role="end"
            candidates={findNodeCandidates(nodes, points[points.length - 1], mergeRadiusM)}
            nameConflict={null}
            decisionChoice={endDecision.choice}
            decisionNodeId={endDecision.nodeId}
            decisionNewName={endDecision.newName}
            onChoice={(v) => setEndDecision((d) => (d ? { ...d, choice: v } : d))}
            onNodeId={(v) => setEndDecision((d) => (d ? { ...d, nodeId: v } : d))}
            onNewName={(v) => setEndDecision((d) => (d ? { ...d, newName: v } : d))}
          />

          <button type="button" className="btn-primary" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? t(locale, "draw.saving") : t(locale, "draw.save")}
          </button>
        </div>
      )}
    </div>
  );
}
