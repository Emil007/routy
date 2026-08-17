"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { pathLengthMeters, closestPointOnPath, type LatLng } from "@/lib/geo";
import { MapViewLazy } from "./MapViewLazy";
import type { MapMarker, MapLine } from "./MapView";

interface SplitTarget {
  point: LatLng;
}

export function EditSegmentWizard({
  locale,
  segmentId,
  initialPoints,
  startNodeName,
  endNodeName,
  networkLines,
}: {
  locale: Locale;
  segmentId: number;
  initialPoints: LatLng[];
  startNodeName: string;
  endNodeName: string;
  networkLines: MapLine[];
}) {
  const router = useRouter();
  const [points, setPoints] = useState<LatLng[]>(initialPoints);
  const [geometryStatus, setGeometryStatus] = useState<"idle" | "saving" | "error">("idle");
  const [geometryMessage, setGeometryMessage] = useState<string | null>(null);

  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);
  const [splitName, setSplitName] = useState("");
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
    setSplitTarget({ point: closest.point });
    setSplitName("");
    setSplitStatus("idle");
    setSplitMessage(null);
  }

  function cancelSplit() {
    setSplitTarget(null);
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
    if (!splitTarget) return;
    setSplitStatus("saving");
    setSplitMessage(null);
    const res = await fetch("/api/segments/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segmentId,
        lat: splitTarget.point.lat,
        lng: splitTarget.point.lng,
        nodeName: splitName.trim() || null,
      }),
    });
    if (res.ok) {
      router.push("/map");
    } else {
      setSplitStatus("error");
      setSplitMessage(t(locale, "edit.splitError"));
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

      {splitTarget && (
        <div className="card stack">
          <h3 style={{ fontSize: "1rem" }}>{t(locale, "edit.splitConfirmTitle")}</h3>
          <div className="field">
            <label>{t(locale, "import.newNodeName")}</label>
            <input type="text" value={splitName} onChange={(e) => setSplitName(e.target.value)} />
          </div>
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
