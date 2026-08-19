"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import type { SegmentRow } from "@/lib/segments";
import { deleteSegmentAction } from "@/app/(app)/map/actions";

// Not imported from "@/lib/segments" — that module pulls in better-sqlite3,
// which must never end up in a client bundle. Same one-line check, duplicated.
function isLocked(segment: Pick<SegmentRow, "lockedUntil">): boolean {
  return segment.lockedUntil !== null && segment.lockedUntil > new Date().toISOString();
}

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
  activeConditions,
  onEditShape,
}: {
  locale: Locale;
  segment: SegmentRow;
  startName: string;
  endName: string;
  canEditSegment: boolean;
  creatorName: string;
  usageCount: number;
  activeConditions?: { id: number; reason: string; expiresAt: string }[];
  onEditShape: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(segment.name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [locking, setLocking] = useState(false);
  const [lockDays, setLockDays] = useState(7);
  const [lockReason, setLockReason] = useState("");
  const [lockStatus, setLockStatus] = useState<"idle" | "saving" | "error">("idle");
  const [reportingCondition, setReportingCondition] = useState(false);
  const [conditionReason, setConditionReason] = useState("muddy");
  const [conditionStatus, setConditionStatus] = useState<"idle" | "saving" | "error">("idle");
  const locked = isLocked(segment);

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

  async function saveLock() {
    setLockStatus("saving");
    const res = await fetch("/api/segments/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id, days: lockDays, reason: lockReason || undefined }),
    });
    if (res.ok) {
      setLocking(false);
      setLockStatus("idle");
      router.refresh();
    } else {
      setLockStatus("error");
    }
  }

  async function saveCondition() {
    setConditionStatus("saving");
    const res = await fetch("/api/segments/condition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id, reason: conditionReason }),
    });
    if (res.ok) {
      setReportingCondition(false);
      setConditionStatus("idle");
      router.refresh();
    } else {
      setConditionStatus("error");
    }
  }

  const conditionReasons = ["muddy", "flooded", "construction", "dog", "icy", "overgrown"] as const;

  async function handleUnlock() {
    setLockStatus("saving");
    const res = await fetch("/api/segments/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id, days: null }),
    });
    if (res.ok) {
      setLockStatus("idle");
      router.refresh();
    } else {
      setLockStatus("error");
    }
  }

  return (
    <div className="stack" style={{ minWidth: 220, gap: "0.4rem" }}>
      <strong>
        {startName} → {endName}
      </strong>
      {segment.name && <span className="chip">{segment.name}</span>}
      {locked && (
        <span className="chip">
          {segment.lockedReason
            ? t(locale, "edit.lockedChipWithReason", {
                date: new Date(segment.lockedUntil!).toLocaleDateString(locale === "de" ? "de-DE" : "en-US"),
                reason: segment.lockedReason,
              })
            : t(locale, "edit.lockedChip", {
                date: new Date(segment.lockedUntil!).toLocaleDateString(locale === "de" ? "de-DE" : "en-US"),
              })}
        </span>
      )}
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

      {activeConditions && activeConditions.length > 0 && (
        <div className="stack" style={{ gap: "0.25rem" }}>
          <span className="hint" style={{ margin: 0 }}>
            {t(locale, "map.conditionActive")}:
          </span>
          <div className="btn-row" style={{ gap: "0.3rem", flexWrap: "wrap" }}>
            {activeConditions.map((c) => (
              <span key={c.id} className="chip">
                {t(locale, `map.conditionReason_${c.reason}` as "map.conditionReason_muddy")}
              </span>
            ))}
          </div>
        </div>
      )}

      {reportingCondition ? (
        <div className="stack" style={{ gap: "0.4rem" }}>
          <label htmlFor={`condition-reason-${segment.id}`}>{t(locale, "map.conditionReason")}</label>
          <select id={`condition-reason-${segment.id}`} value={conditionReason} onChange={(e) => setConditionReason(e.target.value)}>
            {conditionReasons.map((r) => (
              <option key={r} value={r}>
                {t(locale, `map.conditionReason_${r}`)}
              </option>
            ))}
          </select>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={saveCondition} disabled={conditionStatus === "saving"}>
              {t(locale, "map.conditionSubmit")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setReportingCondition(false)}>
              {t(locale, "common.cancel")}
            </button>
          </div>
          {conditionStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setReportingCondition(true)}>
          {t(locale, "map.conditionReport")}
        </button>
      )}

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
        ) : locking ? (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <label htmlFor={`lock-days-${segment.id}`}>{t(locale, "edit.lockDaysLabel")}</label>
            <input
              id={`lock-days-${segment.id}`}
              type="number"
              min={1}
              max={3650}
              value={lockDays}
              onChange={(e) => setLockDays(Math.max(1, Number(e.target.value) || 1))}
            />
            <label htmlFor={`lock-reason-${segment.id}`}>{t(locale, "edit.lockReasonLabel")}</label>
            <input
              id={`lock-reason-${segment.id}`}
              type="text"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder={t(locale, "edit.lockReasonPlaceholder")}
            />
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={saveLock} disabled={lockStatus === "saving"}>
                {t(locale, "edit.lockButton")}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setLocking(false)}>
                {t(locale, "common.cancel")}
              </button>
            </div>
            {lockStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={onEditShape}>
              {t(locale, "edit.editShapeButton")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setRenaming(true)}>
              {t(locale, "map.rename")}
            </button>
            {locked ? (
              <button type="button" className="btn-secondary" onClick={handleUnlock} disabled={lockStatus === "saving"}>
                {t(locale, "edit.unlockButton")}
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setLocking(true)}>
                {t(locale, "edit.lockButton")}
              </button>
            )}
            <button type="button" className="btn-danger" onClick={handleDelete}>
              {t(locale, "map.delete")}
            </button>
          </div>
        ))}
    </div>
  );
}
