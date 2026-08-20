"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "@/components/MapViewLazy";
import { NodePopup } from "@/components/NodePopup";
import { SegmentPopup } from "@/components/SegmentPopup";
import { DrawPathWizard } from "@/components/DrawPathWizard";
import { GpxImportWizard } from "@/components/GpxImportWizard";
import { RecordTrackWizard } from "@/components/RecordTrackWizard";
import { SegmentGeometryEditor } from "@/components/SegmentGeometryEditor";
import type { MapMarker, MapLine, MapViewState } from "@/components/MapView";
import type { NodeRow } from "@/lib/nodes";
import type { SegmentRow } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";

type Mode = "view" | "draw" | "gpx" | "record" | "editShape";

interface SegmentConditionEntry {
  id: number;
  segmentId: number;
  reason: string;
  expiresAt: string;
}

interface PathProposal {
  id: number;
  segmentId: number;
  segmentName: string | null;
  lat: number;
  lng: number;
  createdBy: number;
}

interface LockProposal {
  id: number;
  segmentId: number;
  segmentName: string | null;
  requestedBy: number;
  requesterName: string;
  reason: string | null;
  days: number;
  createdAt: string;
}

// Not imported from "@/lib/segments" — that module pulls in better-sqlite3,
// which must never end up in a client bundle. Same one-line check, duplicated.
function isLocked(segment: Pick<SegmentRow, "lockedUntil">): boolean {
  return segment.lockedUntil !== null && segment.lockedUntil > new Date().toISOString();
}

export function OverviewMapClient({
  locale,
  nodes,
  segments,
  usage,
  segmentCounts,
  currentUser,
  userNames,
  mergeRadiusM,
  walkSpeedKmh,
  segmentConditions,
  personalAvoidSegmentIds,
}: {
  locale: Locale;
  nodes: NodeRow[];
  segments: SegmentRow[];
  usage: Record<number, number>;
  segmentCounts: Record<number, number>;
  currentUser: { id: number; role: "admin" | "user" };
  userNames: Record<number, string>;
  mergeRadiusM: number;
  walkSpeedKmh: number;
  segmentConditions: SegmentConditionEntry[];
  personalAvoidSegmentIds: number[];
}) {
  const router = useRouter();
  const [proposals, setProposals] = useState<PathProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [lockProposals, setLockProposals] = useState<LockProposal[]>([]);
  const [lockProposalsLoading, setLockProposalsLoading] = useState(true);
  const personalAvoidSet = useMemo(() => new Set(personalAvoidSegmentIds), [personalAvoidSegmentIds]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLockProposalsLoading(true);
      const res = await fetch("/api/app/lock-proposals");
      if (!cancelled && res.ok) {
        const data = (await res.json()) as { proposals: LockProposal[] };
        setLockProposals(data.proposals);
      }
      if (!cancelled) setLockProposalsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
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

  async function approveLockProposal(id: number) {
    const res = await fetch("/api/app/lock-proposals/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: id }),
    });
    if (res.ok) {
      setLockProposals((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    }
  }

  async function dismissLockProposal(id: number) {
    const res = await fetch("/api/app/lock-proposals/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: id }),
    });
    if (res.ok) setLockProposals((prev) => prev.filter((p) => p.id !== id));
  }

  const conditionsBySegment = useMemo(() => {
    const map = new Map<number, SegmentConditionEntry[]>();
    for (const c of segmentConditions) {
      const list = map.get(c.segmentId) ?? [];
      list.push(c);
      map.set(c.segmentId, list);
    }
    return map;
  }, [segmentConditions]);
  const [mode, setMode] = useState<Mode>("view");
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [moveNodeId, setMoveNodeId] = useState<number | null>(null);
  const [moveStatus, setMoveStatus] = useState<"idle" | "saving" | "error">("idle");
  // Every mode (view/draw/editShape) mounts its own MapContainer, which would otherwise
  // reset to a fresh fit-to-content on every switch. Remembering the last pan/zoom here
  // lets the next mode's map restore it instead.
  const [lastView, setLastView] = useState<MapViewState | undefined>(undefined);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  function creatorName(id: number | null): string {
    return id !== null ? (userNames[id] ?? `#${id}`) : "–";
  }

  const networkLines: MapLine[] = useMemo(
    () => segments.map((s) => ({ id: s.id, points: s.geometry.map((p): [number, number] => [p.lat, p.lng]) })),
    [segments],
  );

  async function handleMarkerDragEnd(id: number | string, lat: number, lng: number) {
    if (typeof id !== "number") return;
    setMoveStatus("saving");
    const res = await fetch("/api/nodes/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: id, lat, lng }),
    });
    setMoveNodeId(null);
    if (res.ok) {
      setMoveStatus("idle");
      router.refresh();
    } else {
      setMoveStatus("error");
    }
  }

  const markers: MapMarker[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        label: n.name || t(locale, "map.unnamedNode"),
        color: n.isHome ? "#a5711c" : n.id === moveNodeId ? "#1e4a32" : "#2e6b49",
        draggable: n.id === moveNodeId,
        popup: (
          <NodePopup
            locale={locale}
            node={n}
            canEditNode={canEdit(currentUser, n.createdBy)}
            creatorName={creatorName(n.createdBy)}
            segmentCount={segmentCounts[n.id] ?? 0}
            moveModeActive={n.id === moveNodeId}
            onToggleMove={() => setMoveNodeId((cur) => (cur === n.id ? null : n.id))}
          />
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, locale, moveNodeId, currentUser, segmentCounts, userNames],
  );

  const lines: MapLine[] = useMemo(
    () =>
      segments.map((s) => ({
        id: s.id,
        points: s.geometry.map((p): [number, number] => [p.lat, p.lng]),
        dashed: isLocked(s),
        popup: (
          <SegmentPopup
            locale={locale}
            segment={s}
            startName={nodesById.get(s.startNodeId)?.name || `#${s.startNodeId}`}
            endName={nodesById.get(s.endNodeId)?.name || `#${s.endNodeId}`}
            canEditSegment={canEdit(currentUser, s.submittedBy)}
            creatorName={creatorName(s.submittedBy)}
            usageCount={usage[s.id] ?? 0}
            activeConditions={conditionsBySegment.get(s.id)}
            personalAvoided={personalAvoidSet.has(s.id)}
            onEditShape={() => {
              setEditingSegmentId(s.id);
              setMode("editShape");
            }}
          />
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, locale, currentUser, usage, userNames, nodesById],
  );

  if (mode === "draw") {
    return (
      <div className="stack">
        <div className="btn-row">
          <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("view")}>
            {t(locale, "overview.backToView")}
          </button>
        </div>
        <DrawPathWizard
          locale={locale}
          nodes={nodes}
          networkLines={networkLines}
          mergeRadiusM={mergeRadiusM}
          walkSpeedKmh={walkSpeedKmh}
          initialView={lastView}
          onViewChange={setLastView}
        />
      </div>
    );
  }

  if (mode === "gpx") {
    return (
      <div className="stack">
        <div className="btn-row">
          <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("view")}>
            {t(locale, "overview.backToView")}
          </button>
        </div>
        <GpxImportWizard locale={locale} />
      </div>
    );
  }

  if (mode === "record") {
    return (
      <div className="stack">
        <div className="btn-row">
          <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("view")}>
            {t(locale, "overview.backToView")}
          </button>
        </div>
        <RecordTrackWizard
          locale={locale}
          nodes={nodes}
          networkLines={networkLines}
          mergeRadiusM={mergeRadiusM}
          walkSpeedKmh={walkSpeedKmh}
          initialView={lastView}
          onViewChange={setLastView}
        />
      </div>
    );
  }

  if (mode === "editShape" && editingSegmentId !== null) {
    const editing = segments.find((s) => s.id === editingSegmentId);
    if (!editing) {
      setMode("view");
      return null;
    }
    return (
      <SegmentGeometryEditor
        locale={locale}
        segmentId={editing.id}
        initialPoints={editing.geometry}
        startNodeName={nodesById.get(editing.startNodeId)?.name || `#${editing.startNodeId}`}
        endNodeName={nodesById.get(editing.endNodeId)?.name || `#${editing.endNodeId}`}
        networkLines={networkLines.filter((l) => l.id !== editing.id)}
        nodes={nodes}
        mergeRadiusM={mergeRadiusM}
        canEditSegment={canEdit(currentUser, editing.submittedBy)}
        onDone={() => {
          setEditingSegmentId(null);
          setMode("view");
        }}
        initialView={lastView}
        onViewChange={setLastView}
      />
    );
  }

  return (
    <div className="map-overview-shell">
      <MapViewLazy
        height={560}
        markers={markers}
        lines={lines}
        onMarkerDragEnd={handleMarkerDragEnd}
        className="map-box-large"
        initialView={lastView}
        onViewChange={setLastView}
      />
      <div className="record-map-bar">
        <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("draw")}>
          {t(locale, "overview.drawMode")}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("gpx")}>
          {t(locale, "overview.gpxMode")}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("record")}>
          {t(locale, "overview.recordMode")}
        </button>
      </div>
      <p className="hint-compact">{t(locale, "overview.interactionHint")}</p>
      <details className="card" style={{ marginTop: "0.5rem" }}>
        <summary>{t(locale, "map.lockProposalsTitle")} ({lockProposalsLoading ? "…" : lockProposals.length})</summary>
        <div className="stack" style={{ marginTop: "0.45rem", gap: "0.35rem" }}>
          {!lockProposalsLoading && lockProposals.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>{t(locale, "map.lockProposalsEmpty")}</p>
          )}
          {lockProposals.map((p) => (
            <div key={p.id} className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
              <span className="chip">
                {p.segmentName || t(locale, "map.proposalSegment", { id: p.segmentId })}
                {" · "}
                {t(locale, "map.lockProposalFrom", { name: p.requesterName })}
              </span>
              <button type="button" className="btn-primary btn-compact" onClick={() => approveLockProposal(p.id)}>
                {t(locale, "map.lockProposalApprove")}
              </button>
              <button type="button" className="btn-secondary btn-compact" onClick={() => dismissLockProposal(p.id)}>
                {t(locale, "map.lockProposalDismiss")}
              </button>
            </div>
          ))}
        </div>
      </details>
      <details className="card" style={{ marginTop: "0.5rem" }}>
        <summary>{t(locale, "map.proposalsTitle")} ({proposalsLoading ? "…" : proposals.length})</summary>
        <div className="stack" style={{ marginTop: "0.45rem", gap: "0.35rem" }}>
          {!proposalsLoading && proposals.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>{t(locale, "map.proposalsEmpty")}</p>
          )}
          {proposals.map((p) => {
            const segment = segments.find((s) => s.id === p.segmentId);
            const canManage = canEdit(currentUser, segment?.submittedBy ?? null);
            return (
            <div key={p.id} className="btn-row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
              <span className="chip">
                {p.segmentName || t(locale, "map.proposalSegment", { id: p.segmentId })}
              </span>
              {canManage && (
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
      </details>
      {moveStatus === "error" && <div className="alert alert-error" style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem" }}>{t(locale, "common.error")}</div>}
    </div>
  );
}
