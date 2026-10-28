"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import type { AtlasBootstrap } from "@/lib/atlasTypes";
import type { MapLine } from "@/components/MapView";
import { DrawPathWizard } from "@/components/DrawPathWizard";
import { GpxImportWizard } from "@/components/GpxImportWizard";
import { SegmentGeometryEditor } from "@/components/SegmentGeometryEditor";
import { SegmentsTable } from "@/app/(app)/map/SegmentsTable";
import { TrashPanel } from "@/app/(app)/map/TrashPanel";
import { canEdit } from "@/lib/ownership";
import { useMapShell } from "../MapShellContext";

/** Netzlinien für Tool-Hosts (§7.4): dieselbe Ableitung wie RoutePane — die eine
 *  Karte zeigt das Basisnetz, Hosts melden nur Overlay-Layer nach oben. */
function networkLinesFromBootstrap(bootstrap: AtlasBootstrap): MapLine[] {
  const lines: MapLine[] = [];
  for (const [segmentId, points] of Object.entries(bootstrap.segmentGeometries)) {
    if (!points || points.length < 2) continue;
    lines.push({ id: `seg-${segmentId}`, points });
  }
  return lines;
}

interface PathProposal {
  id: number;
  segmentId: number;
  segmentName: string | null;
  lat: number;
  lng: number;
  createdBy: number;
}

/**
 * Erkunden — Sheet-Inhalt der Hülle (§7.4). Enthält das „Netz bearbeiten“-Menü:
 * Zeichnen, GPX, Vorschläge (nur wenn Liste nicht leer), Papierkorb, Segmentliste.
 * Proposals kommen aus /api/app/proposals (hierher verschoben, §J4). Die Werkzeuge
 * laufen als Hosts über der einen Karte (hosted, onLayersChange → registerLayers);
 * GpxImportWizard darf seine Mini-Karte behalten (bewusste Ausnahme, §J4).
 */
export function ExploreSheet({ locale, bootstrap }: { locale: Locale; bootstrap: AtlasBootstrap }) {
  const router = useRouter();
  const { setStage, tool, setTool, registerLayers, editSegmentId, setEditSegmentId } = useMapShell();
  const networkLines = useMemo(() => networkLinesFromBootstrap(bootstrap), [bootstrap.segmentGeometries]);
  const [proposals, setProposals] = useState<PathProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProposalsLoading(true);
      const res = await fetch("/api/app/proposals");
      if (!cancelled && res.ok) {
        const data = (await res.json()) as { proposals: PathProposal[] };
        setProposals(data.proposals);
      }
      if (!cancelled) setProposalsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Beim Verlassen von Erkunden Werkzeug + Overlay zurücksetzen.
  useEffect(() => {
    return () => {
      registerLayers(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acceptProposal(id: number) {
    const res = await fetch("/api/app/proposals/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: id }),
    });
    if (res.ok) {
      setProposals((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    }
  }

  async function dismissProposal(id: number) {
    const res = await fetch("/api/app/proposals/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: id }),
    });
    if (res.ok) setProposals((prev) => prev.filter((p) => p.id !== id));
  }

  function openTool(next: typeof tool) {
    if (next === tool) {
      setTool(null);
    } else {
      setTool(next);
      setStage("half");
    }
  }

  function canManageProposal(p: PathProposal): boolean {
    const seg = bootstrap.segments.find((s) => s.id === p.segmentId);
    if (!seg) return false;
    return bootstrap.role === "admin" || seg.submittedBy === bootstrap.userId;
  }

  return (
    <div className="sheet-body">
      <div className="btn-row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button type="button" className="btn-secondary btn-compact" onClick={() => openTool("draw")}>
          {t(locale, "overview.drawMode")}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => openTool("gpx")}>
          {t(locale, "overview.gpxMode")}
        </button>
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => openTool("proposals")}
          disabled={!proposalsLoading && proposals.length === 0}
        >
          {t(locale, "map.proposalsTitle")} ({proposalsLoading ? "…" : proposals.length})
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => openTool("segments")}>
          {t(locale, "map.segmentsHeading")}
        </button>
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => openTool("trash")}
          disabled={bootstrap.deletedNodes.length === 0 && bootstrap.deletedSegments.length === 0}
        >
          {t(locale, "map.trashHeading")}
        </button>
        {bootstrap.role === "admin" && (
          <button type="button" className="btn-secondary btn-compact" onClick={() => (window.location.href = "/admin/track-geometry")}>
            {t(locale, "admin.trackGeometryHeading")}
          </button>
        )}
      </div>
      {tool === "draw" && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <DrawPathWizard
            locale={locale}
            nodes={bootstrap.nodes}
            networkLines={networkLines}
            mergeRadiusM={bootstrap.mergeRadiusM}
            walkSpeedKmh={bootstrap.walkSpeedKmh}
            hosted
            onLayersChange={registerLayers}
          />
        </div>
      )}

      {tool === "gpx" && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <GpxImportWizard locale={locale} />
        </div>
      )}

      {tool === "segments" && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <SegmentsTable
            locale={locale}
            segments={bootstrap.segments}
            nodes={bootstrap.nodes}
            usage={bootstrap.usage}
            userNames={bootstrap.userNames}
            currentUser={{ id: bootstrap.userId, role: bootstrap.role }}
          />
        </div>
      )}

      {tool === "trash" && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <TrashPanel locale={locale} deletedNodes={bootstrap.deletedNodes} deletedSegments={bootstrap.deletedSegments} />
        </div>
      )}

      {tool === "editShape" && editSegmentId !== null && (() => {
        const editing = bootstrap.segments.find((s) => s.id === editSegmentId);
        if (!editing) return null;
        const nodesById = new Map(bootstrap.nodes.map((n) => [n.id, n]));
        return (
          <div className="stack" style={{ marginTop: "0.5rem" }}>
            <SegmentGeometryEditor
              locale={locale}
              segmentId={editing.id}
              initialPoints={editing.geometry}
              startNodeName={nodesById.get(editing.startNodeId)?.name || `#${editing.startNodeId}`}
              endNodeName={nodesById.get(editing.endNodeId)?.name || `#${editing.endNodeId}`}
              networkLines={networkLines.filter((l) => l.id !== `seg-${editing.id}`)}
              nodes={bootstrap.nodes}
              mergeRadiusM={bootstrap.mergeRadiusM}
              canEditSegment={canEdit({ id: bootstrap.userId, role: bootstrap.role }, editing.submittedBy)}
              onDone={() => {
                setEditSegmentId(null);
                setTool(null);
              }}
              hosted
              onLayersChange={registerLayers}
            />
          </div>
        );
      })()}

      {tool === "proposals" && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <div className="card" style={{ padding: "0.6rem" }}>
            <strong style={{ fontSize: "0.85rem" }}>{t(locale, "map.proposalsTitle")}</strong>
            {!proposalsLoading && proposals.length === 0 && (
              <p className="hint" style={{ margin: 0 }}>{t(locale, "map.proposalsEmpty")}</p>
            )}
            {proposals.map((p) => {
              const segment = bootstrap.segments.find((s) => s.id === p.segmentId);
              const canManage = canManageProposal(p);
              return (
                <div key={p.id} className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                  <span className="chip">
                    {p.segmentName || t(locale, "map.proposalSegment", { id: p.segmentId })}
                  </span>
                  {canManage && segment && (
                    <>
                      <button type="button" className="btn-primary btn-compact" onClick={() => acceptProposal(p.id)}>
                        {t(locale, "map.proposalAccept")}
                      </button>
                      <button type="button" className="btn-secondary btn-compact" onClick={() => dismissProposal(p.id)}>
                        {t(locale, "map.proposalDismiss")}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
