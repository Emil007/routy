"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { NamePartsInput } from "./NamePartsInput";
import type { NodeRow } from "@/lib/nodes";
import { setHomeNodeAction, deleteNodeAction } from "@/app/(app)/map/actions";

/** Real Leaflet popup content for a node marker — info for everyone, owner-gated
 * actions (rename/move/home/delete) only when `canEditNode`. */
export function NodePopup({
  locale,
  node,
  canEditNode,
  creatorName,
  segmentCount,
  moveModeActive,
  onToggleMove,
}: {
  locale: Locale;
  node: NodeRow;
  canEditNode: boolean;
  creatorName: string;
  segmentCount: number;
  moveModeActive: boolean;
  onToggleMove: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [part1, setPart1] = useState(node.namePart1Text ?? node.name ?? "");
  const [part2, setPart2] = useState(node.namePart2Text ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function saveRename() {
    setStatus("saving");
    const res = await fetch("/api/nodes/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, part1, part2 }),
    });
    if (res.ok) {
      setRenaming(false);
      setStatus("idle");
      router.refresh();
    } else {
      setStatus("error");
    }
  }

  async function handleSetHome() {
    const fd = new FormData();
    fd.set("nodeId", String(node.id));
    await setHomeNodeAction(fd);
    router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm(t(locale, "map.deleteNodeConfirm", { count: segmentCount }))) return;
    const fd = new FormData();
    fd.set("nodeId", String(node.id));
    await deleteNodeAction(fd);
    router.refresh();
  }

  return (
    <div className="stack" style={{ minWidth: 220, gap: "0.4rem" }}>
      <strong>{node.name || t(locale, "map.unnamedNode")}</strong>
      {node.isHome && <span className="chip">{t(locale, "map.home")}</span>}
      <p className="hint" style={{ margin: 0 }}>
        {t(locale, "map.createdBy")}: {creatorName}
      </p>

      {canEditNode &&
        (renaming ? (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <NamePartsInput
              locale={locale}
              point={{ lat: node.lat, lng: node.lng }}
              part1={part1}
              part2={part2}
              onPart1={setPart1}
              onPart2={setPart2}
            />
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={saveRename} disabled={status === "saving" || !part1.trim()}>
                {t(locale, "map.rename")}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setRenaming(false)}>
                {t(locale, "common.cancel")}
              </button>
            </div>
            {status === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => setRenaming(true)}>
              {t(locale, "map.rename")}
            </button>
            {!node.isHome && (
              <button type="button" className="btn-secondary" onClick={handleSetHome}>
                {t(locale, "map.home")}
              </button>
            )}
            <button type="button" className={moveModeActive ? "btn-primary" : "btn-secondary"} onClick={onToggleMove}>
              {moveModeActive ? t(locale, "map.moveNodeActive") : t(locale, "map.moveNode")}
            </button>
            <button type="button" className="btn-danger" onClick={handleDelete}>
              {t(locale, "map.delete")}
            </button>
          </div>
        ))}
    </div>
  );
}
