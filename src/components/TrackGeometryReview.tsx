"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "./MapViewLazy";

interface WalkRow {
  id: number;
  userDisplayName: string;
  nickname: string | null;
  acceptedAt: string;
  lengthM: number;
  pointCount: number;
}

interface SuggestionRow {
  walkId: number;
  segmentId: number;
  segmentName: string | null;
  points: { lat: number; lng: number }[];
  officialGeometry: { lat: number; lng: number }[];
  firstRecordingGeometry: { lat: number; lng: number }[] | null;
  isOutlier: boolean;
  avgDistanceToOfficialM: number;
  avgDistanceToFirstRecordingM: number | null;
  resolution: "pending" | "accepted" | "discarded";
}

type OverlayMode = "official" | "suggestion" | "both" | "first";

function pickNextPending(list: SuggestionRow[], afterSegmentId: number | null): number | null {
  const pending = list.filter((s) => s.resolution === "pending" && !s.isOutlier);
  if (pending.length === 0) return null;
  if (afterSegmentId == null) return pending[0].segmentId;
  const idx = pending.findIndex((s) => s.segmentId === afterSegmentId);
  if (idx >= 0 && idx + 1 < pending.length) return pending[idx + 1].segmentId;
  return pending[0]?.segmentId ?? null;
}

export function TrackGeometryReview({ locale }: { locale: Locale }) {
  const [walks, setWalks] = useState<WalkRow[]>([]);
  const [selectedWalkId, setSelectedWalkId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("both");
  const [status, setStatus] = useState<"idle" | "loading" | "accepting" | "discarding" | "removing">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadWalks = useCallback(async () => {
    setStatus("loading");
    const res = await fetch("/api/admin/track-geometry/walks");
    if (res.ok) {
      const data = (await res.json()) as { walks: WalkRow[] };
      setWalks(data.walks);
    }
    setStatus("idle");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadWalks();
    });
  }, [loadWalks]);

  useEffect(() => {
    if (selectedWalkId === null) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      const res = await fetch(`/api/admin/track-geometry/walk/${selectedWalkId}`);
      if (!cancelled && res.ok) {
        const data = (await res.json()) as { suggestions: SuggestionRow[] };
        const list = data.suggestions.filter((s) => !s.isOutlier);
        setSuggestions(list);
        setSelectedSegmentId(pickNextPending(list, null));
        setOverlayMode("both");
      }
      if (!cancelled) setStatus("idle");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWalkId]);

  const orderedSuggestions = useMemo(() => {
    const pending = suggestions.filter((s) => s.resolution === "pending");
    const resolved = suggestions.filter((s) => s.resolution !== "pending");
    return [...pending, ...resolved];
  }, [suggestions]);

  const selected = useMemo(
    () => suggestions.find((s) => s.segmentId === selectedSegmentId) ?? null,
    [suggestions, selectedSegmentId],
  );

  const mapLines = useMemo(() => {
    if (!selected) return [];
    const official = {
      id: "official",
      points: selected.officialGeometry.map((p) => [p.lat, p.lng] as [number, number]),
      color: "#2e6b49",
      weight: 5,
    };
    const suggestion = {
      id: "suggestion",
      points: selected.points.map((p) => [p.lat, p.lng] as [number, number]),
      color: "#2563eb",
      weight: 5,
      dashed: true,
    };
    const first =
      selected.firstRecordingGeometry && selected.firstRecordingGeometry.length >= 2
        ? {
            id: "first",
            points: selected.firstRecordingGeometry.map((p) => [p.lat, p.lng] as [number, number]),
            color: "#a5711c",
            weight: 4,
            dashed: true,
          }
        : null;

    if (overlayMode === "official") return [official];
    if (overlayMode === "suggestion") return [suggestion];
    if (overlayMode === "first") return first ? [first] : [official];
    return first ? [official, suggestion, first] : [official, suggestion];
  }, [selected, overlayMode]);

  async function reloadSuggestions(resolvedSegmentId: number) {
    if (selectedWalkId === null) return;
    const detailRes = await fetch(`/api/admin/track-geometry/walk/${selectedWalkId}`);
    if (!detailRes.ok) return;
    const data = (await detailRes.json()) as { suggestions: SuggestionRow[] };
    const list = data.suggestions.filter((s) => !s.isOutlier);
    setSuggestions(list);
    setSelectedSegmentId(pickNextPending(list, resolvedSegmentId));
  }

  async function handleAccept() {
    if (!selected || selectedWalkId === null || selected.resolution !== "pending") return;
    const segmentId = selected.segmentId;
    setStatus("accepting");
    setMessage(null);
    const res = await fetch("/api/admin/track-geometry/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkId: selectedWalkId, segmentId }),
    });
    if (res.ok) {
      setMessage(t(locale, "admin.trackGeometryAccepted"));
      await reloadSuggestions(segmentId);
      void loadWalks();
    } else {
      setMessage(t(locale, "common.error"));
    }
    setStatus("idle");
  }

  async function handleDiscard() {
    if (!selected || selectedWalkId === null || selected.resolution !== "pending") return;
    const segmentId = selected.segmentId;
    setStatus("discarding");
    setMessage(null);
    const res = await fetch("/api/admin/track-geometry/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkId: selectedWalkId, segmentId }),
    });
    if (res.ok) {
      setMessage(t(locale, "admin.trackGeometryDiscarded"));
      await reloadSuggestions(segmentId);
      void loadWalks();
    } else {
      setMessage(t(locale, "common.error"));
    }
    setStatus("idle");
  }

  async function handleRemoveRecording() {
    if (selectedWalkId === null) return;
    if (!window.confirm(t(locale, "admin.trackGeometryRemoveRecordingConfirm"))) return;
    setStatus("removing");
    setMessage(null);
    const res = await fetch("/api/admin/track-geometry/remove-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkId: selectedWalkId }),
    });
    if (res.ok) {
      setMessage(t(locale, "admin.trackGeometryRemoveRecordingDone"));
      setSelectedWalkId(null);
      setSuggestions([]);
      setSelectedSegmentId(null);
      void loadWalks();
    } else {
      setMessage(t(locale, "common.error"));
    }
    setStatus("idle");
  }

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="card">
        <h2>{t(locale, "admin.trackGeometryWalksHeading")}</h2>
        {walks.length === 0 ? (
          <p className="hint">{t(locale, "admin.trackGeometryEmpty")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "admin.trackGeometryWhen")}</th>
                  <th>{t(locale, "admin.trackGeometryWho")}</th>
                  <th>{t(locale, "route.routeNamePlaceholder")}</th>
                  <th>{t(locale, "route.distanceLabel")}</th>
                  <th>{t(locale, "admin.trackGeometryPoints")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {walks.map((w) => (
                  <tr key={w.id} className={selectedWalkId === w.id ? "row-selected" : undefined}>
                    <td>{new Date(w.acceptedAt.replace(" ", "T") + "Z").toLocaleString(locale === "de" ? "de-DE" : "en-US")}</td>
                    <td>{w.userDisplayName}</td>
                    <td>{w.nickname || "—"}</td>
                    <td>{(w.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}</td>
                    <td>{w.pointCount}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => {
                          setSelectedWalkId(w.id);
                          setSuggestions([]);
                          setSelectedSegmentId(null);
                        }}
                      >
                        {t(locale, "admin.trackGeometryReview")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedWalkId !== null && (
        <div className="card">
          <h2>{t(locale, "admin.trackGeometrySuggestionsHeading")}</h2>
          <p className="hint-compact">{t(locale, "admin.trackGeometryScopeHint")}</p>
          {orderedSuggestions.length === 0 ? (
            <p className="hint">{t(locale, "admin.trackGeometryNoSuggestions")}</p>
          ) : (
            <>
              <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                {orderedSuggestions.map((s) => {
                  const resolved = s.resolution !== "pending";
                  const selectedChip = selectedSegmentId === s.segmentId;
                  return (
                    <button
                      key={s.segmentId}
                      type="button"
                      className={selectedChip ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                      style={resolved ? { opacity: 0.45 } : undefined}
                      onClick={() => {
                        setSelectedSegmentId(s.segmentId);
                        setOverlayMode("both");
                      }}
                    >
                      {s.segmentName || t(locale, "map.proposalSegment", { id: s.segmentId })}
                      {s.resolution === "accepted"
                        ? ` · ${t(locale, "admin.trackGeometryResolvedAccepted")}`
                        : s.resolution === "discarded"
                          ? ` · ${t(locale, "admin.trackGeometryResolvedDiscarded")}`
                          : ""}
                    </button>
                  );
                })}
              </div>

              {selected && (
                <>
                  <div className="btn-row track-geometry-overlay-row" style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}>
                    {(
                      [
                        ["official", "admin.trackGeometryOverlayOfficial"],
                        ["suggestion", "admin.trackGeometryOverlaySuggestion"],
                        ["both", "admin.trackGeometryOverlayBoth"],
                        ["first", "admin.trackGeometryOverlayFirst"],
                      ] as const
                    ).map(([mode, key]) => (
                      <label key={mode} className="checkbox">
                        <input
                          type="radio"
                          name="overlay"
                          checked={overlayMode === mode}
                          onChange={() => setOverlayMode(mode)}
                        />
                        {t(locale, key)}
                      </label>
                    ))}
                  </div>
                  <p className="hint-compact">
                    {t(locale, "admin.trackGeometryDistanceHint", {
                      official: selected.avgDistanceToOfficialM,
                      first: selected.avgDistanceToFirstRecordingM ?? "—",
                    })}
                  </p>
                  <MapViewLazy locale={locale} lines={mapLines} height={420} fitKey={`${selected.segmentId}-${overlayMode}`} />
                  {selected.resolution === "pending" ? (
                    <div className="btn-row" style={{ marginTop: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn-primary btn-compact"
                        onClick={() => void handleAccept()}
                        disabled={status === "accepting" || status === "discarding"}
                        title={t(locale, "admin.trackGeometryAcceptHint")}
                      >
                        {status === "accepting" ? t(locale, "common.loading") : t(locale, "admin.trackGeometryAccept")}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => void handleDiscard()}
                        disabled={status === "accepting" || status === "discarding"}
                        title={t(locale, "admin.trackGeometryDiscardHint")}
                      >
                        {status === "discarding" ? t(locale, "common.loading") : t(locale, "admin.trackGeometryDiscard")}
                      </button>
                    </div>
                  ) : (
                    <p className="hint" style={{ marginTop: "0.5rem" }}>
                      {selected.resolution === "accepted"
                        ? t(locale, "admin.trackGeometryAlreadyAccepted")
                        : t(locale, "admin.trackGeometryAlreadyDiscarded")}
                    </p>
                  )}
                </>
              )}
            </>
          )}
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn-danger btn-compact"
              onClick={() => void handleRemoveRecording()}
              disabled={status === "removing"}
            >
              {status === "removing" ? t(locale, "common.loading") : t(locale, "admin.trackGeometryRemoveRecording")}
            </button>
          </div>
          {message && <p className="hint" style={{ marginTop: "0.5rem" }}>{message}</p>}
        </div>
      )}
    </div>
  );
}
