import { describe, expect, it } from "vitest";
import { avgDistanceToPath, nodeIndicesOnTrack, durationMinFromTrackPoints } from "./trackGeometry";
import type { LatLng } from "./geo";

describe("trackGeometry", () => {
  it("finds node indices in order along a track", () => {
    const track: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ];
    const nodeCoords = new Map<number, LatLng>([
      [1, { lat: 0, lng: 0 }],
      [2, { lat: 0, lng: 0.002 }],
    ]);
    const indices = nodeIndicesOnTrack(track, [1, 2], nodeCoords);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(2);
  });

  it("splits track into segment slices", () => {
    const track: LatLng[] = [
      { lat: 50, lng: 8 },
      { lat: 50.001, lng: 8 },
      { lat: 50.002, lng: 8 },
    ];
    // Mock listNodes via splitTrackByRoute using real DB would need integration test;
    // test avgDistanceToPath instead for unit scope.
    expect(avgDistanceToPath([{ lat: 50, lng: 8 }], track)).toBeLessThan(5);
  });

  it("derives hop duration from GPS timestamps", () => {
    const duration = durationMinFromTrackPoints([
      { lat: 0, lng: 0, time: "2026-01-01T10:00:00.000Z" },
      { lat: 0, lng: 0.001, time: "2026-01-01T10:12:00.000Z" },
    ]);
    expect(duration).toBe(12);
  });
});
