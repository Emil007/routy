import { describe, expect, it } from "vitest";
import { initialMode, requestModeChange } from "./mapMode";
import type { AtlasMode, LiveSession } from "./mapMode";

const modes: AtlasMode[] = ["explore", "plan", "go", "record"];

describe("initialMode", () => {
  it("returns record when a recording is live", () => {
    expect(initialMode({ requested: "explore", hasActiveRoute: false, freeRoamActive: false, recordingLive: true })).toBe("record");
  });

  it("returns go when free-roam is running", () => {
    expect(initialMode({ requested: null, hasActiveRoute: false, freeRoamActive: true, recordingLive: false })).toBe("go");
  });

  it("M3: active route opens the Route chip (plan), not free go", () => {
    expect(initialMode({ requested: null, hasActiveRoute: true, freeRoamActive: false, recordingLive: false })).toBe("plan");
  });

  it("prefers a requested mode over the plan default", () => {
    expect(initialMode({ requested: "explore", hasActiveRoute: false, freeRoamActive: false, recordingLive: false })).toBe("explore");
    expect(initialMode({ requested: "plan", hasActiveRoute: false, freeRoamActive: false, recordingLive: false })).toBe("plan");
  });

  it("defaults to plan (Route) for parity with Android", () => {
    expect(initialMode({ requested: null, hasActiveRoute: false, freeRoamActive: false, recordingLive: false })).toBe("plan");
  });

  it("M3: active route falls back to plan by default; explicit explore still opens explore", () => {
    expect(initialMode({ requested: "plan", hasActiveRoute: true, freeRoamActive: false, recordingLive: false })).toBe("plan");
    expect(initialMode({ requested: "explore", hasActiveRoute: true, freeRoamActive: false, recordingLive: false })).toBe("explore");
    expect(initialMode({ requested: "explore", hasActiveRoute: false, freeRoamActive: false, recordingLive: false })).toBe("explore");
  });
});

describe("requestModeChange", () => {
  it("allows same-mode toggles", () => {
    for (const mode of modes) {
      expect(requestModeChange(mode, mode, { kind: "activeRoute" }, false)).toEqual({ allow: true });
    }
  });

  it("allows free explore→plan when nothing is live", () => {
    expect(requestModeChange("explore", "plan", { kind: "none" }, false)).toEqual({ allow: true });
  });

  it("blocks leaving an active route without a confirm", () => {
    expect(requestModeChange("go", "explore", { kind: "activeRoute" }, false)).toEqual({ allow: false, confirm: "stop-route" });
  });

  it("blocks leaving free-roam without a confirm", () => {
    expect(requestModeChange("go", "plan", { kind: "freeRoam" }, false)).toEqual({ allow: false, confirm: "stop-roam" });
  });

  it("web: leaving a record mode asks to stop the watch", () => {
    expect(requestModeChange("record", "explore", { kind: "record" }, false)).toEqual({ allow: false, confirm: "stop-record" });
  });

  it("android: leaving a record mode is allowed, service keeps running", () => {
    expect(requestModeChange("record", "explore", { kind: "record" }, true)).toEqual({ allow: true });
  });

  it("allows plan→go for an unaccepted suggestion (none)", () => {
    expect(requestModeChange("plan", "go", { kind: "none" }, false)).toEqual({ allow: true });
  });
});
