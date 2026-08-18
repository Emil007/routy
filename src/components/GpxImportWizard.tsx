"use client";

import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "./MapViewLazy";
import { EndpointFields } from "./EndpointFields";
import type { ElevationStats, LatLng } from "@/lib/geo";
import type { NodeCandidate } from "@/lib/nodeMatching";

interface TrackPreview {
  index: number;
  name: string | null;
  points: LatLng[];
  lengthM: number;
  durationMin: number;
  elevation: ElevationStats | null;
  startNameGuess: string | null;
  endNameGuess: string | null;
  startCandidates: NodeCandidate[];
  endCandidates: NodeCandidate[];
  startNameConflict: NodeCandidate | null;
  endNameConflict: NodeCandidate | null;
}

interface TrackDecision {
  skip: boolean;
  startChoice: "existing" | "new";
  startNodeId: number | null;
  startNewName: string;
  markStartAsHome: boolean;
  endChoice: "existing" | "new";
  endNodeId: number | null;
  endNewName: string;
}

function initialDecision(track: TrackPreview): TrackDecision {
  return {
    skip: false,
    startChoice: track.startCandidates.length > 0 ? "existing" : "new",
    startNodeId: track.startCandidates[0]?.id ?? null,
    startNewName: track.startNameGuess ?? "",
    markStartAsHome: false,
    endChoice: track.endCandidates.length > 0 ? "existing" : "new",
    endNodeId: track.endCandidates[0]?.id ?? null,
    endNewName: track.endNameGuess ?? "",
  };
}

export function GpxImportWizard({ locale }: { locale: Locale }) {
  const [file, setFile] = useState<File | null>(null);
  const [tracks, setTracks] = useState<TrackPreview[] | null>(null);
  const [decisions, setDecisions] = useState<TrackDecision[]>([]);
  const [status, setStatus] = useState<"idle" | "parsing" | "committing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStatus("parsing");
    setErrorMsg(null);
    setSuccessMsg(null);

    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/gpx/parse", { method: "POST", body: form });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus("error");
      setErrorMsg(body.error === "no_tracks" ? t(locale, "import.noTracks") : t(locale, "common.error"));
      return;
    }

    const data = (await res.json()) as { tracks: TrackPreview[] };
    setTracks(data.tracks);
    setDecisions(data.tracks.map(initialDecision));
    setStatus("idle");
  }

  function updateDecision(index: number, patch: Partial<TrackDecision>) {
    setDecisions((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleCommit() {
    if (!tracks) return;
    setStatus("committing");
    setErrorMsg(null);

    const payloadTracks = tracks
      .map((track, i) => ({ track, decision: decisions[i] }))
      .filter(({ decision }) => !decision.skip)
      .map(({ track, decision }) => ({
        points: track.points,
        lengthM: track.lengthM,
        durationMin: track.durationMin,
        elevation: track.elevation,
        markStartAsHome: decision.markStartAsHome,
        start:
          decision.startChoice === "existing" && decision.startNodeId
            ? { nodeId: decision.startNodeId }
            : { newName: decision.startNewName || null },
        end:
          decision.endChoice === "existing" && decision.endNodeId
            ? { nodeId: decision.endNodeId }
            : { newName: decision.endNewName || null },
      }));

    if (payloadTracks.length === 0) {
      setStatus("idle");
      return;
    }

    const res = await fetch("/api/gpx/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: payloadTracks }),
    });

    if (res.ok) {
      const data = (await res.json()) as { saved: number };
      setSuccessMsg(t(locale, "import.success", { count: data.saved }));
      setTracks(null);
      setDecisions([]);
      setFile(null);
      setStatus("idle");
    } else {
      setStatus("error");
      setErrorMsg(t(locale, "common.error"));
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <form onSubmit={handleUpload} className="stack">
          <div className="field">
            <label htmlFor="gpxFile">{t(locale, "import.chooseFile")}</label>
            <input
              id="gpxFile"
              type="file"
              accept=".gpx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!file || status === "parsing"}>
            {status === "parsing" ? t(locale, "import.parsing") : t(locale, "import.upload")}
          </button>
        </form>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {tracks && tracks.length > 0 && (
        <div className="stack">
          {tracks.map((track, i) => {
            const decision = decisions[i];
            if (!decision) return null;
            const start = track.points[0];
            const end = track.points[track.points.length - 1];
            return (
              <div className="card stack" key={track.index}>
                <h3 style={{ fontSize: "1rem" }}>
                  {track.name || t(locale, "import.unnamedTrack")} — {t(locale, "import.trackName", { index: i + 1 })}
                </h3>

                <MapViewLazy
                  lines={[{ id: "track", points: track.points.map((p): [number, number] => [p.lat, p.lng]) }]}
                  markers={[
                    { id: "start", lat: start.lat, lng: start.lng, color: "#a5711c", label: t(locale, "import.startNode") },
                    { id: "end", lat: end.lat, lng: end.lng, color: "#2e6b49", label: t(locale, "import.endNode") },
                  ]}
                  height={220}
                />

                <div className="btn-row">
                  <span className="chip">
                    {t(locale, "import.length")}: {(track.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
                  </span>
                  <span className="chip">
                    {t(locale, "import.duration")}: {track.durationMin} {t(locale, "common.min")}
                  </span>
                  {track.elevation && (
                    <>
                      <span className="chip">↗ {track.elevation.gainM} m</span>
                      <span className="chip">↘ {track.elevation.lossM} m</span>
                    </>
                  )}
                </div>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={decision.skip}
                    onChange={(e) => updateDecision(i, { skip: e.target.checked })}
                  />
                  {t(locale, "import.skipTrack")}
                </label>

                {!decision.skip && (
                  <>
                    <EndpointFields
                      locale={locale}
                      role="start"
                      point={start}
                      candidates={track.startCandidates}
                      nameConflict={track.startNameConflict}
                      decisionChoice={decision.startChoice}
                      decisionNodeId={decision.startNodeId}
                      decisionNewName={decision.startNewName}
                      onChoice={(v) => updateDecision(i, { startChoice: v })}
                      onNodeId={(v) => updateDecision(i, { startNodeId: v })}
                      onNewName={(v) => updateDecision(i, { startNewName: v })}
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={decision.markStartAsHome}
                        onChange={(e) => updateDecision(i, { markStartAsHome: e.target.checked })}
                      />
                      {t(locale, "import.markAsHome")}
                    </label>
                    <EndpointFields
                      locale={locale}
                      role="end"
                      point={end}
                      candidates={track.endCandidates}
                      nameConflict={track.endNameConflict}
                      decisionChoice={decision.endChoice}
                      decisionNodeId={decision.endNodeId}
                      decisionNewName={decision.endNewName}
                      onChoice={(v) => updateDecision(i, { endChoice: v })}
                      onNodeId={(v) => updateDecision(i, { endNodeId: v })}
                      onNewName={(v) => updateDecision(i, { endNewName: v })}
                    />
                  </>
                )}
              </div>
            );
          })}

          <button type="button" className="btn-primary" onClick={handleCommit} disabled={status === "committing"}>
            {status === "committing" ? t(locale, "import.committing") : t(locale, "import.commit")}
          </button>
        </div>
      )}
    </div>
  );
}
