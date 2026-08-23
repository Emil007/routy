import { XMLParser } from "fast-xml-parser";
import { type LatLng, pathLengthMeters, estimateMinutes, elevationStats, type ElevationStats } from "./geo";

export interface ParsedTrack {
  name: string | null;
  startNameGuess: string | null;
  endNameGuess: string | null;
  points: LatLng[];
  lengthM: number;
  durationMin: number;
  elevation: ElevationStats | null;
}

// Matches the naming convention from the legacy bot: "Start - Ziel", "Start → Ziel", etc.
const NAME_SPLIT = /\s*[-→–>]+\s*/;

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface RawPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
}

export class GpxParseError extends Error {}

export function parseGpx(xml: string, walkSpeedKmh: number): ParsedTrack[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });

  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new GpxParseError("Die Datei konnte nicht als XML gelesen werden.");
  }

  const gpx = (doc as Record<string, unknown>)?.gpx as Record<string, unknown> | undefined;
  if (!gpx) {
    throw new GpxParseError("Keine gültige GPX-Datei (fehlendes <gpx>-Element).");
  }

  const tracks = toArray(gpx.trk as unknown | unknown[]);
  const result: ParsedTrack[] = [];

  for (const trk of tracks as Record<string, unknown>[]) {
    const segs = toArray(trk.trkseg as unknown | unknown[]) as Record<string, unknown>[];
    const rawPoints: RawPoint[] = [];

    for (const seg of segs) {
      for (const pt of toArray(seg.trkpt as unknown | unknown[]) as Record<string, unknown>[]) {
        const lat = Number(pt["@_lat"]);
        const lng = Number(pt["@_lon"]);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const eleRaw = pt.ele;
        const eleVal = eleRaw !== undefined ? Number(eleRaw) : NaN;
        const timeRaw = pt.time;
        rawPoints.push({
          lat,
          lng,
          ele: Number.isNaN(eleVal) ? undefined : eleVal,
          time: typeof timeRaw === "string" ? timeRaw : undefined,
        });
      }
    }

    if (rawPoints.length < 2) continue;

    const points: LatLng[] = rawPoints.map(({ lat, lng, ele }) => ({ lat, lng, ele }));
    const lengthM = Math.round(pathLengthMeters(points));

    const t0 = rawPoints[0].time ? Date.parse(rawPoints[0].time) : NaN;
    const t1 = rawPoints[rawPoints.length - 1].time ? Date.parse(rawPoints[rawPoints.length - 1].time as string) : NaN;
    const durationMin =
      !Number.isNaN(t0) && !Number.isNaN(t1) && t1 > t0
        ? Math.round((t1 - t0) / 60000)
        : estimateMinutes(lengthM, walkSpeedKmh);

    const nameRaw = trk.name;
    const name = typeof nameRaw === "string" ? nameRaw : nameRaw != null ? String(nameRaw) : null;
    let startNameGuess: string | null = null;
    let endNameGuess: string | null = null;
    if (name) {
      const parts = name
        .split(NAME_SPLIT)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= 1) startNameGuess = parts[0];
      if (parts.length >= 2) endNameGuess = parts[1];
    }

    result.push({
      name,
      startNameGuess,
      endNameGuess,
      points,
      lengthM,
      durationMin,
      elevation: elevationStats(points),
    });
  }

  return result;
}

export interface WalkGpxPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
}

/** Build a GPX 1.1 document from a walked GPS track. */
export function buildWalkGpx(opts: {
  name: string;
  points: WalkGpxPoint[];
  description?: string;
}): string {
  const pts = opts.points.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  const trkpts = pts
    .map((p) => {
      const ele = p.ele != null && !Number.isNaN(p.ele) ? `\n        <ele>${p.ele}</ele>` : "";
      const time = p.time ? `\n        <time>${p.time}</time>` : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">${ele}${time}\n      </trkpt>`;
    })
    .join("\n");
  const desc = opts.description
    ? `\n    <desc>${escapeXml(opts.description)}</desc>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Routy" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(opts.name)}</name>${desc}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
