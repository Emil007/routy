"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "@/components/MapViewLazy";
import type { MapMarker, MapLine } from "@/components/MapView";
import type { NodeRow } from "@/lib/nodes";
import { canEdit } from "@/lib/ownership";
import { renameNodeAction, setHomeNodeAction, deleteNodeAction } from "./actions";

export function MapPageClient({
  locale,
  nodes,
  lines,
  segmentCounts,
  currentUser,
  userNames,
}: {
  locale: Locale;
  nodes: NodeRow[];
  lines: MapLine[];
  /** Number of physical path segments touching each node id — for the delete-confirm message. */
  segmentCounts: Map<number, number>;
  currentUser: { id: number; role: "admin" | "user" };
  userNames: Record<number, string>;
}) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [moveStatus, setMoveStatus] = useState<"idle" | "saving" | "error">("idle");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const markers: MapMarker[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        label: n.name || t(locale, "map.unnamedNode"),
        color: n.isHome ? "#a5711c" : n.id === selectedNodeId ? "#1e4a32" : "#2e6b49",
        draggable: moveMode && n.id === selectedNodeId,
      })),
    [nodes, locale, selectedNodeId, moveMode],
  );

  function handleMarkerClick(id: number | string) {
    if (typeof id !== "number") return;
    setSelectedNodeId(id);
    setMoveMode(false);
    setMoveStatus("idle");
  }

  function handleLineClick(id: number | string) {
    router.push(`/map/edit/${id}`);
  }

  async function handleMarkerDragEnd(id: number | string, lat: number, lng: number) {
    if (typeof id !== "number") return;
    setMoveStatus("saving");
    const res = await fetch("/api/nodes/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: id, lat, lng }),
    });
    setMoveMode(false);
    if (res.ok) {
      setMoveStatus("idle");
      router.refresh();
    } else {
      setMoveStatus("error");
    }
  }

  function closeSelection() {
    setSelectedNodeId(null);
    setMoveMode(false);
  }

  return (
    <div className="stack">
      <div className="card stack">
        <MapViewLazy
          height={420}
          markers={markers}
          lines={lines}
          onMarkerClick={handleMarkerClick}
          onMarkerDragEnd={handleMarkerDragEnd}
          onLineClick={handleLineClick}
        />
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>{t(locale, "map.interactionHint")}</p>
      </div>

      {selectedNode && (
        <div className="card stack">
          <div className="btn-row">
            <strong>{selectedNode.name || t(locale, "map.unnamedNode")}</strong>
            {selectedNode.isHome && <span className="chip">{t(locale, "map.home")}</span>}
            <span className="chip">
              {t(locale, "map.createdBy")}: {selectedNode.createdBy !== null ? (userNames[selectedNode.createdBy] ?? `#${selectedNode.createdBy}`) : "–"}
            </span>
            <button type="button" className="btn-secondary" onClick={closeSelection}>
              {t(locale, "common.cancel")}
            </button>
          </div>

          {canEdit(currentUser, selectedNode.createdBy) && (
            <>
              <form action={renameNodeAction} className="btn-row">
                <input type="hidden" name="nodeId" value={selectedNode.id} />
                <input type="text" name="name" defaultValue={selectedNode.name ?? ""} style={{ maxWidth: 200 }} />
                <button type="submit" className="btn-secondary">
                  {t(locale, "map.rename")}
                </button>
              </form>

              <div className="btn-row">
                {!selectedNode.isHome && (
                  <form action={setHomeNodeAction}>
                    <input type="hidden" name="nodeId" value={selectedNode.id} />
                    <button type="submit" className="btn-secondary">
                      {t(locale, "map.home")}
                    </button>
                  </form>
                )}
                <button
                  type="button"
                  className={moveMode ? "btn-primary" : "btn-secondary"}
                  onClick={() => setMoveMode((v) => !v)}
                  disabled={moveStatus === "saving"}
                >
                  {moveMode ? t(locale, "map.moveNodeActive") : t(locale, "map.moveNode")}
                </button>
                <form
                  action={deleteNodeAction}
                  onSubmit={(e) => {
                    const count = segmentCounts.get(selectedNode.id) ?? 0;
                    if (!window.confirm(t(locale, "map.deleteNodeConfirm", { count }))) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="nodeId" value={selectedNode.id} />
                  <button type="submit" className="btn-danger">
                    {t(locale, "map.delete")}
                  </button>
                </form>
              </div>

              {moveStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
