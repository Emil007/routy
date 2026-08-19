import { describe, expect, it } from "vitest";
import { walkPathPoints } from "./walkPathPoints";
import type { LatLng } from "./geo";

describe("walkPathPoints", () => {
  const seg1: LatLng[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
  ];
  const seg2: LatLng[] = [
    { lat: 0, lng: 2 },
    { lat: 1, lng: 2 },
  ];
  const geometry = new Map<number, LatLng[]>([
    [1, seg1],
    [2, seg2],
  ]);

  it("chains segment geometry without duplicating junction points", () => {
    const path = walkPathPoints([1, 2], geometry);
    expect(path).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
      { lat: 1, lng: 2 },
    ]);
  });

  it("falls back to node-chain coords when segment geometry is missing", () => {
    const coords = new Map<number, LatLng>([
      [10, { lat: 5, lng: 5 }],
      [11, { lat: 6, lng: 6 }],
    ]);
    const path = walkPathPoints([], new Map(), { nodeChain: [10, 11], coords });
    expect(path).toEqual([
      { lat: 5, lng: 5 },
      { lat: 6, lng: 6 },
    ]);
  });
});
