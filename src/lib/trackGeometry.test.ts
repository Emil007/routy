import { describe, expect, it } from "vitest";
import {
  avgDistanceToPath,
  nodeIndicesOnTrack,
  durationMinFromTrackPoints,
  trimSuggestionTrack,
  orientSliceToCanonical,
  type TrackPoint,
} from "./trackGeometry";
import type { LatLng } from "./geo";
import { filterRoutableEdges } from "./routeContext";

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
    expect(avgDistanceToPath([{ lat: 50, lng: 8 }], track)).toBeLessThan(5);
  });

  it("derives hop duration from GPS timestamps", () => {
    const duration = durationMinFromTrackPoints([
      { lat: 0, lng: 0, time: "2026-01-01T10:00:00.000Z" },
      { lat: 0, lng: 0.001, time: "2026-01-01T10:12:00.000Z" },
    ]);
    expect(duration).toBe(12);
  });

  it("derives duration after reversing a reverse-hop slice (times go high→low)", () => {
    const walkedReverse: TrackPoint[] = [
      { lat: 0, lng: 0.001, time: "2026-01-01T10:12:00.000Z" },
      { lat: 0, lng: 0, time: "2026-01-01T10:00:00.000Z" },
    ];
    const oriented = orientSliceToCanonical(walkedReverse, true);
    expect(oriented[0]!.lng).toBe(0);
    expect(oriented[oriented.length - 1]!.lng).toBe(0.001);
    expect(durationMinFromTrackPoints(oriented)).toBe(12);
  });

  it("orients reverse-walked GPS to canonical direction", () => {
    const reverseHop: TrackPoint[] = [
      { lat: 50.002, lng: 8, time: "t2" },
      { lat: 50.001, lng: 8, time: "t1" },
      { lat: 50, lng: 8, time: "t0" },
    ];
    const oriented = orientSliceToCanonical(reverseHop, true);
    expect(oriented.map((p) => p.lat)).toEqual([50, 50.001, 50.002]);
    expect(orientSliceToCanonical(reverseHop, false)).toEqual(reverseHop);
  });

  it("trims long standstills from suggestion tracks", () => {
    const points: TrackPoint[] = [
      { lat: 50, lng: 8, time: "2026-01-01T10:00:00.000Z" },
      { lat: 50.00001, lng: 8, time: "2026-01-01T10:01:00.000Z" },
      { lat: 50.00002, lng: 8, time: "2026-01-01T10:02:30.000Z" },
      { lat: 50.001, lng: 8, time: "2026-01-01T10:03:00.000Z" },
    ];
    const trimmed = trimSuggestionTrack(points);
    expect(trimmed.length).toBeLessThan(points.length);
    expect(trimmed[0].lat).toBe(50);
    expect(trimmed[trimmed.length - 1].lat).toBe(50.001);
  });
});

describe("filterRoutableEdges one-way", () => {
  it("excludes reverse sibling when forward is one-way", () => {
    const segments = [
      { id: 1, reverseOf: 2, oneWay: true, lockedUntil: null, startNodeId: 10, endNodeId: 20, lengthM: 100, durationMin: 2 },
      { id: 2, reverseOf: 1, oneWay: false, lockedUntil: null, startNodeId: 20, endNodeId: 10, lengthM: 100, durationMin: 2 },
    ];
    const edges = filterRoutableEdges(segments);
    expect(edges.map((e) => e.id)).toEqual([1]);
  });
});
