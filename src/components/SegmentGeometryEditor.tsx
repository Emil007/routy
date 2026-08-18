"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, closestPointOnPath, type LatLng } from "@/lib/geo";
import { findNodeCandidates } from "@/lib/nodeMatching";
import { MapViewLazy } from "./MapViewLazy";
import { EndpointFields } from "./EndpointFields";
import type { NodeRow } from "@/lib/nodes";
import type { MapMarker, MapLine, MapViewState } from "./MapView";

interface SplitTarget {
  point: LatLng;
}

interface SplitDecision {
  choice: "existing" | "new";
  nodeId: number | null;
  part1: string;
  part2: string;
}

/**
 * Inline "Form bearbeiten" mode for a segment, embedded directly in the Übersicht map
 * instead of a separate page. Two things can happen on a line click, picked via an
 * explicit toggle so there's no ambiguity: insert a plain point (default), or split off a
 * new junction node (the previous /map/edit behavior). Interior points can also be dragged
 * or removed (via their own popup) — endpoints stay pinned to their nodes.
 */
export function SegmentGeometryEditor({
  locale,
  segmentId,
  initialPoints,
  startNodeName,
  endNodeName,
  networkLines,
  nodes,
  mergeRadiusM,
  canEditSegment,
  onDone,
  initialView,
  onViewChange,
}: {
  locale: Locale;
  segmentId: number;
  initialPoints: LatLng[];
  startNodeName: string;
  endNodeName: string;
  networkLines: MapLine[];
  nodes: NodeRow[];
  mergeRadiusM: number;
  canEditSegment: boolean;
  onDone: () => void;
  initialView?: MapViewState;
  onViewChange?: (view: MapViewState) => void;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<LatLng[]>(initialPoints);
  const [lineAction, setLineAction] = useState<"addPoint" | "split">("addPoint");
  const [geometryStatus, setGeometryStatus] = useState<"idle" | "saving" | "error">("idle");
  const [geometryMessage, setGeometryMessage] = useState<string | null>(null);

  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);
  const [splitDecision, setSplitDecision] = useState<SplitDecision | null>(null);
  const [splitStatus, setSplitStatus] = useState<"idle" | "saving" | "error">("idle");
  const [splitMessage, setSplitMessage] = useState<string | null>(null);

  const lengthM = useMemo(() => Math.round(pathLengthMeters(points)), [points]);

  const editLine: MapLine = useMemo(
    () => ({ id: "edit", points: points.map((p): [number, number] => [p.lat, p.lng]), color: "#9a3b29", weight: 5 }),
    [points],
  );

  function removePoint(index: number) {
    setPoints((prev) => prev.filter((_, i) => i !== index));
    setGeometryStatus("idle");
    setGeometryMessage(null);
  }

  const vertexMarkers: MapMarker[] = useMemo(
    () =>
      points.map((p, i) => {
        const isEndpoint = i === 0 || i === points.length - 1;
        const removable = canEditSegment && !isEndpoint && points.length > 2;
        return {
          id: `v-${i}`,
          lat: p.lat,
          lng: p.lng,
          color: isEndpoint ? "#a5711c" : "#9a3b29",
          draggable: canEditSegment && !isEndpoint,
          popup: removable ? (
            <button type="button" className="btn-danger" onClick={() => removePoint(i)}>
              {t(locale, "edit.removePoint")}
            </button>
          ) : undefined,
        };
      }),
    [points, canEditSegment, locale],
  );

  const splitMarkers: MapMarker[] = splitTarget
    ? [{ id: "split-preview", lat: splitTarget.point.lat, lng: splitTarget.point.lng, color: "#1e4a32" }]
    : [];

  const splitCandidates = useMemo(
    () => (splitTarget ? findNodeCandidates(nodes, splitTarget.point, mergeRadiusM) : []),
    [splitTarget, nodes, mergeRadiusM],
  );

  function handleVertexDragEnd(id: number | string, lat: number, lng: number) {
    if (typeof id !== "string" || !id.startsWith("v-")) return;
    const index = Number(id.slice(2));
    setPoints((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], lat, lng };
      return next;
    });
    setGeometryStatus("idle");
    setGeometryMessage(null);
  }

  function handleLineClick(id: number | string, lat: number, lng: number) {
    if (id !== "edit" || !canEditSegment) return;
    const closest = closestPointOnPath(points, { lat, lng });
    if (!closest) return;

    if (lineAction === "addPoint") {
      setPoints((prev) => [...prev.slice(0, closest.index + 1), closest.point, ...prev.slice(closest.index + 1)]);
      setGeometryStatus("idle");
      setGeometryMessage(null);
      return;
    }

    const candidates = findNodeCandidates(nodes, closest.point, mergeRadiusM);
    setSplitTarget({ point: closest.point });
    setSplitDecision(
      candidates.length > 0
        ? { choice: "existing", nodeId: candidates[0].id, part1: "", part2: "" }
        : { choice: "new", nodeId: null, part1: "", part2: "" },
    );
    setSplitStatus("idle");
    setSplitMessage(null);
  }

  function cancelSplit() {
    setSplitTarget(null);
    setSplitDecision(null);
  }

  async function saveGeometry() {
    setGeometryStatus("saving");
    setGeometryMessage(null);
    const res = await fetch("/api/segments/geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId, points }),
    });
    if (res.ok) {
      setGeometryStatus("idle");
      setGeometryMessage(t(locale, "edit.saved"));
      router.refresh();
    } else {
      setGeometryStatus("error");
      setGeometryMessage(t(locale, "edit.saveError"));
    }
  }

  async function confirmSplit() {
    if (!splitTarget || !splitDecision) return;
    setSplitStatus("saving");
    setSplitMessage(null);
    const res = await fetch("/api/segments/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segmentId,
        lat: splitTarget.point.lat,
        lng: splitTarget.point.lng,
        endpoint:
          splitDecision.choice === "existing" && splitDecision.nodeId
            ? { nodeId: splitDecision.nodeId }
            : { part1: splitDecision.part1, part2: splitDecision.part2 },
      }),
    });
    if (res.ok) {
      router.refresh();
      onDone();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setSplitStatus("error");
      setSplitMessage(body?.error === "segment_active" ? t(locale, "edit.splitBlockedActive") : t(locale, "edit.splitError"));
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <MapViewLazy
          height={420}
          autoFit={false}
          lines={[...networkLines, editLine]}
          markers={[...vertexMarkers, ...splitMarkers]}
          onLineClick={handleLineClick}
          onMarkerDragEnd={handleVertexDragEnd}
          initialView={initialView}
          onViewChange={onViewChange}
        />

        <div className="btn-row">
          <span className="chip">
            {startNodeName} → {endNodeName}
          </span>
          <span className="chip">
            {(lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
          </span>
        </div>

        {canEditSegment && (
          <div className="btn-row">
            <button
              type="button"
              className={lineAction === "addPoint" ? "btn-primary" : "btn-secondary"}
              onClick={() => setLineAction("addPoint")}
            >
              {t(locale, "edit.addPointMode")}
            </button>
            <button
              type="button"
              className={lineAction === "split" ? "btn-primary" : "btn-secondary"}
              onClick={() => setLineAction("split")}
            >
              {t(locale, "edit.splitMode")}
            </button>
          </div>
        )}
        {canEditSegment && <p className="hint">{lineAction === "addPoint" ? t(locale, "edit.addPointHint") : t(locale, "edit.splitModeHint")}</p>}

        <div className="btn-row">
          {canEditSegment && (
            <button type="button" className="btn-primary" onClick={saveGeometry} disabled={geometryStatus === "saving"}>
              {geometryStatus === "saving" ? t(locale, "edit.saving") : t(locale, "edit.saveGeometry")}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onDone}>
            {t(locale, "edit.backToMap")}
          </button>
        </div>
        {!canEditSegment && <p className="hint">{t(locale, "map.editBlockedNotOwner")}</p>}

        {geometryMessage && (
          <div className={geometryStatus === "error" ? "alert alert-error" : "alert alert-success"}>{geometryMessage}</div>
        )}
      </div>

      {splitTarget && splitDecision && (
        <div className="card stack">
          <h3 style={{ fontSize: "1rem" }}>{t(locale, "edit.splitConfirmTitle")}</h3>

          <EndpointFields
            locale={locale}
            role="split"
            point={splitTarget.point}
            candidates={splitCandidates}
            nameConflict={null}
            decisionChoice={splitDecision.choice}
            decisionNodeId={splitDecision.nodeId}
            decisionPart1={splitDecision.part1}
            decisionPart2={splitDecision.part2}
            onChoice={(v) => setSplitDecision((d) => (d ? { ...d, choice: v } : d))}
            onNodeId={(v) => setSplitDecision((d) => (d ? { ...d, nodeId: v } : d))}
            onPart1={(v) => setSplitDecision((d) => (d ? { ...d, part1: v } : d))}
            onPart2={(v) => setSplitDecision((d) => (d ? { ...d, part2: v } : d))}
          />

          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={confirmSplit} disabled={splitStatus === "saving"}>
              {splitStatus === "saving" ? t(locale, "edit.splitting") : t(locale, "edit.splitButton")}
            </button>
            <button type="button" className="btn-secondary" onClick={cancelSplit}>
              {t(locale, "common.cancel")}
            </button>
          </div>
          {splitMessage && <div className="alert alert-error">{splitMessage}</div>}
        </div>
      )}
    </div>
  );
}
