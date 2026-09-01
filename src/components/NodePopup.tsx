"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { NamePartsInput } from "./NamePartsInput";
import type { NodeRow } from "@/lib/nodes";
import { isNodeOpenAt } from "@/lib/nodeOpeningHours";
import { setHomeNodeAction, deleteNodeAction } from "@/app/(app)/map/actions";

/** Real Leaflet popup content for a node marker — set-home is per-user (any signed-in
 * profile); rename/move/delete stay owner-gated via `canEditNode`. */
export function NodePopup({
  locale,
  node,
  isUserHome,
  canEditNode,
  creatorName,
  segmentCount,
  moveModeActive,
  onToggleMove,
}: {
  locale: Locale;
  node: NodeRow;
  isUserHome: boolean;
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
  const [showHours, setShowHours] = useState(false);
  const [openFrom, setOpenFrom] = useState(
    node.openFromMinutes != null ? String(Math.floor(node.openFromMinutes / 60)).padStart(2, "0") + ":" + String(node.openFromMinutes % 60).padStart(2, "0") : "08:00",
  );
  const [openUntil, setOpenUntil] = useState(
    node.openUntilMinutes != null ? String(Math.floor(node.openUntilMinutes / 60)).padStart(2, "0") + ":" + String(node.openUntilMinutes % 60).padStart(2, "0") : "18:00",
  );
  const [hoursStatus, setHoursStatus] = useState<"idle" | "saving" | "error">("idle");

  const closedNow = !isNodeOpenAt(node);
  const hasHours = node.openFromMinutes != null && node.openUntilMinutes != null;

  function parseMinutes(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

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

  async function saveOpeningHours(clear = false) {
    setHoursStatus("saving");
    const from = parseMinutes(openFrom);
    const until = parseMinutes(openUntil);
    const res = await fetch("/api/nodes/opening-hours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        clear
          ? { nodeId: node.id, clear: true }
          : { nodeId: node.id, openFromMinutes: from, openUntilMinutes: until },
      ),
    });
    if (res.ok) {
      setShowHours(false);
      setHoursStatus("idle");
      router.refresh();
    } else {
      setHoursStatus("error");
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
      {isUserHome && <span className="chip">{t(locale, "map.home")}</span>}
      {hasHours && closedNow && <span className="chip">{t(locale, "map.openingHoursClosedChip")}</span>}
      <p className="hint" style={{ margin: 0 }}>
        {t(locale, "map.createdBy")}: {creatorName}
      </p>

      {canEditNode && renaming ? (
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
          {canEditNode && (
            <button type="button" className="btn-secondary" onClick={() => setRenaming(true)}>
              {t(locale, "map.rename")}
            </button>
          )}
          {!isUserHome && (
            <button type="button" className="btn-secondary" onClick={handleSetHome}>
              {t(locale, "map.home")}
            </button>
          )}
          {canEditNode && (
            <>
              <button type="button" className={moveModeActive ? "btn-primary" : "btn-secondary"} onClick={onToggleMove}>
                {moveModeActive ? t(locale, "map.moveNodeActive") : t(locale, "map.moveNode")}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowHours((v) => !v)}>
                {t(locale, "map.openingHours")}
              </button>
              <button type="button" className="btn-danger" onClick={handleDelete}>
                {t(locale, "map.delete")}
              </button>
            </>
          )}
        </div>
      )}

      {canEditNode && showHours && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <label htmlFor={`open-from-${node.id}`}>{t(locale, "map.openingHoursFrom")}</label>
          <input id={`open-from-${node.id}`} type="time" value={openFrom} onChange={(e) => setOpenFrom(e.target.value)} />
          <label htmlFor={`open-until-${node.id}`}>{t(locale, "map.openingHoursUntil")}</label>
          <input id={`open-until-${node.id}`} type="time" value={openUntil} onChange={(e) => setOpenUntil(e.target.value)} />
          <div className="btn-row">
            <button type="button" className="btn-primary btn-compact" onClick={() => saveOpeningHours(false)} disabled={hoursStatus === "saving"}>
              {t(locale, "common.save")}
            </button>
            {hasHours && (
              <button type="button" className="btn-secondary btn-compact" onClick={() => saveOpeningHours(true)} disabled={hoursStatus === "saving"}>
                {t(locale, "map.openingHoursClear")}
              </button>
            )}
          </div>
          {hoursStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
        </div>
      )}
    </div>
  );
}
