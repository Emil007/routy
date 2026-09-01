"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import type { SegmentRow } from "@/lib/segments";
import { deleteSegmentAction } from "@/app/(app)/map/actions";

function isLocked(segment: Pick<SegmentRow, "lockedUntil">): boolean {
  return segment.lockedUntil !== null && segment.lockedUntil > new Date().toISOString();
}

const RESTRICT_REASONS = ["muddy", "flooded", "construction", "dog", "icy", "overgrown"] as const;

/**
 * Unified restrict vocabulary (0.46 F5): align map popups with route planning —
 * personal scope = "Excluded", global for non-owner = lock proposal, owner/admin = global lock.
 */
/** Leaflet popup for a segment — unified restrict dialog + owner edit actions. */
export function SegmentPopup({
  locale,
  segment,
  startName,
  endName,
  canEditSegment,
  creatorName,
  usageCount,
  activeConditions,
  personalAvoided,
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
  personalAvoided?: boolean;
  onEditShape: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(segment.name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [showRestrict, setShowRestrict] = useState(false);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [restrictDays, setRestrictDays] = useState(7);
  const [restrictReason, setRestrictReason] = useState("muddy");
  const [restrictStatus, setRestrictStatus] = useState<"idle" | "saving" | "error">("idle");
  const [oneWay, setOneWay] = useState(segment.oneWay);
  const [oneWayStatus, setOneWayStatus] = useState<"idle" | "saving" | "error">("idle");
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

  async function submitRestrict(clear = false) {
    setRestrictStatus("saving");
    const res = await fetch("/api/segments/restrict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segmentId: segment.id,
        scope: clear ? (personalAvoided ? "personal" : "global") : scope,
        reason: restrictReason,
        days: restrictDays,
        clear,
      }),
    });
    if (res.ok) {
      setShowRestrict(false);
      setRestrictStatus("idle");
      router.refresh();
    } else {
      setRestrictStatus("error");
    }
  }

  async function toggleOneWay(next: boolean) {
    setOneWayStatus("saving");
    const res = await fetch("/api/segments/one-way", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id, oneWay: next }),
    });
    if (res.ok) {
      setOneWay(next);
      setOneWayStatus("idle");
      router.refresh();
    } else {
      setOneWayStatus("error");
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
      {personalAvoided && <span className="chip">{t(locale, "map.personalAvoidChip")}</span>}
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

      {showRestrict ? (
        <div className="stack" style={{ gap: "0.4rem" }}>
          <label>{t(locale, "map.restrictScope")}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as "personal" | "global")}>
            <option value="personal">{t(locale, "map.restrictScopePersonal")}</option>
            <option value="global">
              {canEditSegment ? t(locale, "map.restrictScopeGlobal") : t(locale, "map.restrictScopeRecommend")}
            </option>
          </select>
          <label htmlFor={`restrict-reason-${segment.id}`}>{t(locale, "map.conditionReason")}</label>
          <select id={`restrict-reason-${segment.id}`} value={restrictReason} onChange={(e) => setRestrictReason(e.target.value)}>
            {RESTRICT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(locale, `map.conditionReason_${r}`)}
              </option>
            ))}
          </select>
          <label htmlFor={`restrict-days-${segment.id}`}>{t(locale, "edit.lockDaysLabel")}</label>
          <input
            id={`restrict-days-${segment.id}`}
            type="number"
            min={1}
            max={3650}
            value={restrictDays}
            onChange={(e) => setRestrictDays(Math.max(1, Number(e.target.value) || 1))}
          />
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={() => submitRestrict(false)} disabled={restrictStatus === "saving"}>
              {t(locale, "map.restrictSubmit")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowRestrict(false)}>
              {t(locale, "common.cancel")}
            </button>
          </div>
          {(personalAvoided || (canEditSegment && locked)) && (
            <button type="button" className="btn-secondary" onClick={() => submitRestrict(true)} disabled={restrictStatus === "saving"}>
              {t(locale, "map.restrictClear")}
            </button>
          )}
          {restrictStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setShowRestrict(true)}>
          {t(locale, "map.restrictButton")}
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
        ) : (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={oneWay}
                disabled={oneWayStatus === "saving"}
                onChange={(e) => void toggleOneWay(e.target.checked)}
              />
              {t(locale, "edit.oneWay")}
            </label>
            {oneWayStatus === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
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
          </div>
        ))}
    </div>
  );
}
