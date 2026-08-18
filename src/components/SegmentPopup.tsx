"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import type { SegmentRow } from "@/lib/segments";
import { deleteSegmentAction } from "@/app/(app)/map/actions";

/** Real Leaflet popup content for a segment line — info for everyone, owner-gated
 * actions (rename/edit shape/delete) only when `canEditSegment`. */
export function SegmentPopup({
  locale,
  segment,
  startName,
  endName,
  canEditSegment,
  creatorName,
  usageCount,
  onEditShape,
}: {
  locale: Locale;
  segment: SegmentRow;
  startName: string;
  endName: string;
  canEditSegment: boolean;
  creatorName: string;
  usageCount: number;
  onEditShape: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(segment.name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function saveRename() {
    setStatus("saving");
    const res = await fetch("/api/segments/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id, name }),
    });
    if (res.ok) {
      setRenaming(false);
      setStatus("idle");
      router.refresh();
    } else {
      setStatus("error");
    }
  }

  async function handleDelete() {
    if (!window.confirm(t(locale, "map.deleteConfirm"))) return;
    const fd = new FormData();
    fd.set("segmentId", String(segment.id));
    await deleteSegmentAction(fd);
    router.refresh();
  }

  return (
    <div className="stack" style={{ minWidth: 220, gap: "0.4rem" }}>
      <strong>
        {startName} → {endName}
      </strong>
      {segment.name && <span className="chip">{segment.name}</span>}
      <div className="btn-row" style={{ gap: "0.3rem" }}>
        <span className="chip">
          {(segment.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
        </span>
        <span className="chip">
          {segment.durationMin} {t(locale, "common.min")}
        </span>
        {segment.elevation && (
          <span className="chip">
            ↗{segment.elevation.gainM} ↘{segment.elevation.lossM} m
          </span>
        )}
        <span className="chip">{t(locale, "map.usageCount", { count: usageCount })}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t(locale, "map.createdBy")}: {creatorName}
      </p>

      {canEditSegment &&
        (renaming ? (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <label>{t(locale, "edit.renameSegment")}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(locale, "edit.renameSegmentPlaceholder")} />
            <p className="hint">{t(locale, "edit.renameSegmentHint")}</p>
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={saveRename} disabled={status === "saving"}>
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
            <button type="button" className="btn-secondary" onClick={onEditShape}>
              {t(locale, "edit.editShapeButton")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setRenaming(true)}>
              {t(locale, "map.rename")}
            </button>
            <button type="button" className="btn-danger" onClick={handleDelete}>
              {t(locale, "map.delete")}
            </button>
          </div>
        ))}
    </div>
  );
}
