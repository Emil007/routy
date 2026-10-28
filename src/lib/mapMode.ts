export type AtlasMode = "explore" | "plan" | "go" | "record";
export type ExploreTool =
  | null
  | "draw"
  | "gpx"
  | "editShape"
  | "segments"
  | "trash"
  | "proposals";

export type LiveSession =
  | { kind: "none" }
  | { kind: "activeRoute" }
  | { kind: "freeRoam" }
  | { kind: "record" };

export function initialMode(opts: {
  requested: AtlasMode | null;
  hasActiveRoute: boolean;
  freeRoamActive: boolean;
  recordingLive: boolean;
}): AtlasMode {
  if (opts.recordingLive) return "record";
  if (opts.freeRoamActive) return "go";
  // M3-1: eine am Account gespeicherte Route öffnet den Route-Chip mit der
  // Zwischenseite (plan) — NICHT frei go. Erst Go (trackEnabled) kippt auf go.
  // Ein expliziter Request (z.B. explore) übersteuert; Default ist Route (plan).
  if (opts.hasActiveRoute && opts.requested !== null) return opts.requested;
  return opts.requested ?? "plan";
}

export type ModeChangeResult =
  | { allow: true }
  | { allow: false; confirm: "stop-route" | "stop-roam" | "stop-record" };

export function requestModeChange(
  from: AtlasMode,
  to: AtlasMode,
  live: LiveSession,
  recordContinuesInBackground: boolean,
): ModeChangeResult {
  if (from === to) return { allow: true };

  if (live.kind === "record" && to !== "record") {
    if (recordContinuesInBackground) return { allow: true };
    return { allow: false, confirm: "stop-record" };
  }
  if (live.kind === "activeRoute" && to !== "go") {
    return { allow: false, confirm: "stop-route" };
  }
  if (live.kind === "freeRoam" && to !== "go") {
    return { allow: false, confirm: "stop-roam" };
  }
  return { allow: true };
}
