import { haversineMeters } from "./geo";
import { t, type Locale } from "./i18n";

const MAX_ANNOUNCE_RADIUS_M = 40;
const MIN_ANNOUNCE_RADIUS_M = 12;
const DISTANCE_FRACTION = 0.35;

export interface VoiceStation {
  name: string | null;
  speakName?: string | null;
  lat: number;
  lng: number;
  viaSegmentName?: string | null;
}

/** Spec D4: min(40 m, 0.35 × distance to next station), floor 12 m. Last station uses 40 m. */
export function voiceAnnounceRadiusM(stationIndex: number, stations: VoiceStation[]): number {
  const next = stations[stationIndex + 1];
  if (!next) return MAX_ANNOUNCE_RADIUS_M;
  const here = stations[stationIndex];
  const legM = haversineMeters(here, next);
  return Math.max(MIN_ANNOUNCE_RADIUS_M, Math.min(MAX_ANNOUNCE_RADIUS_M, DISTANCE_FRACTION * legM));
}

export function stationSpeakName(station: VoiceStation): string | null {
  return station.speakName ?? station.name;
}

export function formatStationLabel(
  locale: Locale,
  name: string | null | undefined,
  viaSegmentName: string | null | undefined,
  fallbackKey = "route.station",
): string {
  const base = name || t(locale, fallbackKey);
  if (!viaSegmentName) return base;
  return t(locale, "route.stationVia", { base, via: viaSegmentName });
}
