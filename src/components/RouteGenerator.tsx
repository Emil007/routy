"use client";

import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { MapViewLazy } from "./MapViewLazy";
import type { NodeRow } from "@/lib/nodes";

interface RouteStation {
  nodeId: number;
  name: string | null;
  lat: number;
  lng: number;
}

interface RouteDisplayPayload {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  stations: RouteStation[];
  cornerstones: RouteStation[];
  elevation: { gainM: number; lossM: number } | null;
  geometry: [number, number][];
}

interface GenerateResponse {
  token: string;
  route: RouteDisplayPayload;
}

export function RouteGenerator({ locale, nodes, homeNodeId }: { locale: Locale; nodes: NodeRow[]; homeNodeId: number | null }) {
  const [startNodeId, setStartNodeId] = useState<number | "">(homeNodeId ?? "");
  const [isLoop, setIsLoop] = useState(true);
  const [destinationNodeId, setDestinationNodeId] = useState<number | "">(homeNodeId ?? "");
  const [waypointNodeId, setWaypointNodeId] = useState<number | "">("");

  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function nodeName(id: number): string {
    return nodes.find((n) => n.id === id)?.name || `#${id}`;
  }

  async function callApi(path: string, body: unknown): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function handleSuggest(e: React.FormEvent) {
    e.preventDefault();
    if (!startNodeId) return;
    setStatus("loading");
    setMessage(null);
    const res = await callApi("/api/route/generate", {
      startNodeId,
      destinationNodeId: isLoop ? startNodeId : destinationNodeId || startNodeId,
      waypointNodeId: waypointNodeId || null,
    });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
    } else {
      setResult(null);
      setStatus("error");
      setMessage(t(locale, "route.noRouteFound"));
    }
  }

  async function handleAnother() {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/widen", { token: result.token });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
      setMessage(null);
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.noAlternative"));
    }
  }

  async function handleAdjust(direction: "longer" | "shorter") {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/adjust", { token: result.token, direction });
    if (res.ok) {
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStatus("idle");
      setMessage(null);
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.noAlternative"));
    }
  }

  async function handleAccept() {
    if (!result) return;
    setStatus("loading");
    const res = await callApi("/api/route/accept", { token: result.token });
    if (res.ok) {
      setResult(null);
      setStatus("idle");
      setMessage(t(locale, "route.accepted"));
    } else {
      setStatus("idle");
      setMessage(t(locale, "route.sessionExpired"));
    }
  }

  async function handleCancel() {
    if (!result) return;
    await callApi("/api/route/cancel", { token: result.token });
    setResult(null);
    setMessage(null);
  }

  return (
    <div className="stack">
      <div className="card">
        <form onSubmit={handleSuggest} className="stack">
          <div className="field">
            <label htmlFor="startNode">{t(locale, "route.start")}</label>
            <select id="startNode" value={startNodeId} onChange={(e) => setStartNodeId(Number(e.target.value))}>
              <option value="" disabled>
                …
              </option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name || `#${n.id}`}
                  {n.isHome ? ` (${t(locale, "map.home")})` : ""}
                </option>
              ))}
            </select>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={isLoop} onChange={(e) => setIsLoop(e.target.checked)} />
            {t(locale, "route.loop")}
          </label>

          {!isLoop && (
            <div className="field">
              <label htmlFor="destinationNode">{t(locale, "route.destination")}</label>
              <select
                id="destinationNode"
                value={destinationNodeId}
                onChange={(e) => setDestinationNodeId(Number(e.target.value))}
              >
                <option value="" disabled>
                  …
                </option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name || `#${n.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="waypointNode">
              {t(locale, "route.waypoint")} ({t(locale, "common.optional")})
            </label>
            <select id="waypointNode" value={waypointNodeId} onChange={(e) => setWaypointNodeId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t(locale, "route.waypointNone")}</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name || `#${n.id}`}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary" disabled={status === "loading" || !startNodeId}>
            {status === "loading" ? t(locale, "route.generating") : t(locale, "route.suggest")}
          </button>
        </form>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      {result && (
        <div className="card stack">
          <MapViewLazy
            lines={[{ id: "route", points: result.route.geometry }]}
            markers={result.route.stations.map((s, idx) => ({
              id: `${s.nodeId}-${idx}`,
              lat: s.lat,
              lng: s.lng,
              label: s.name || `#${s.nodeId}`,
              color: idx === 0 ? "#a5711c" : "#2e6b49",
            }))}
            height={360}
          />

          <div className="btn-row">
            <span className="chip">
              {t(locale, "route.distanceLabel")}: {(result.route.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
            </span>
            <span className="chip">
              {t(locale, "route.durationLabel")}: {result.route.durationMin} {t(locale, "common.min")}
            </span>
            {result.route.elevation && (
              <>
                <span className="chip">
                  ↗ {t(locale, "route.elevationGain", { gain: result.route.elevation.gainM })}
                </span>
                <span className="chip">
                  ↘ {t(locale, "route.elevationLoss", { loss: result.route.elevation.lossM })}
                </span>
              </>
            )}
          </div>

          <div>
            <strong style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "route.stationList")}</strong>
            <p style={{ marginTop: "0.3rem" }}>
              {result.route.cornerstones.map((s) => s.name || nodeName(s.nodeId)).join(" › ")}
            </p>
          </div>

          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => handleAdjust("shorter")} disabled={status === "loading"}>
              {t(locale, "route.shorter")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => handleAdjust("longer")} disabled={status === "loading"}>
              {t(locale, "route.longer")}
            </button>
            <button type="button" className="btn-secondary" onClick={handleAnother} disabled={status === "loading"}>
              {t(locale, "route.newRoute")}
            </button>
            <button type="button" className="btn-primary" onClick={handleAccept} disabled={status === "loading"}>
              {t(locale, "route.accept")}
            </button>
            <button type="button" className="btn-danger" onClick={handleCancel} disabled={status === "loading"}>
              {t(locale, "route.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
