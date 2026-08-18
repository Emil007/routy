"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, closestPointOnPath, type LatLng } from "@/lib/geo";
import { findNodeCandidates } from "@/lib/nodeMatching";
import { MapViewLazy } from "./MapViewLazy";
import { EndpointFields } from "./EndpointFields";
import type { NodeRow } from "@/lib/nodes";
import type { MapMarker, MapLine } from "./MapView";

interface SplitTarget {
  point: LatLng;
}

interface SplitDecision {
  choice: "existing" | "new";
  nodeId: number | null;
  newName: string;
}

export function EditSegmentWizard({
  locale,
  segmentId,
  initialPoints,
  startNodeName,
  endNodeName,
  networkLines,
  nodes,
  mergeRadiusM,
}: {
  locale: Locale;
  segmentId: number;
  initialPoints: LatLng[];
  startNodeName: string;
  endNodeName: string;
  networkLines: MapLine[];
  nodes: NodeRow[];
  mergeRadiusM: number;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<LatLng[]>(initialPoints);
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

  const vertexMarkers: MapMarker[] = useMemo(
    () =>
      points.map((p, i) => ({
        id: `v-${i}`,
        lat: p.lat,
        lng: p.lng,
        color: i === 0 || i === points.length - 1 ? "#a5711c" : "#9a3b29",
        draggable: i !== 0 && i !== points.length - 1,
      })),
    [points],
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
    if (id !== "edit") return;
    const closest = closestPointOnPath(points, { lat, lng });
    if (!closest) return;
    const candidates = findNodeCandidates(nodes, closest.point, mergeRadiusM);
    setSplitTarget({ point: closest.point });
    setSplitDecision(
      candidates.length > 0
        ? { choice: "existing", nodeId: candidates[0].id, newName: "" }
        : { choice: "new", nodeId: null, newName: "" },
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
            : { newName: splitDecision.newName || null },
      }),
    });
    if (res.ok) {
      router.push("/map");
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
        />

        <div className="btn-row">
          <span className="chip">
            {startNodeName} → {endNodeName}
          </span>
          <span className="chip">
            {(lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
          </span>
        </div>

        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={saveGeometry} disabled={geometryStatus === "saving"}>
            {geometryStatus === "saving" ? t(locale, "edit.saving") : t(locale, "edit.saveGeometry")}
          </button>
          <Link href="/map" className="btn-secondary">
            {t(locale, "edit.backToMap")}
          </Link>
        </div>

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
            decisionNewName={splitDecision.newName}
            onChoice={(v) => setSplitDecision((d) => (d ? { ...d, choice: v } : d))}
            onNodeId={(v) => setSplitDecision((d) => (d ? { ...d, nodeId: v } : d))}
            onNewName={(v) => setSplitDecision((d) => (d ? { ...d, newName: v } : d))}
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
