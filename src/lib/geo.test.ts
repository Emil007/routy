import { describe, expect, it } from "vitest";
import {
  haversineMeters,
  pathLengthMeters,
  estimateMinutes,
  elevationStats,
  reversePoints,
  closestPointOnPath,
  segmentsCross,
  countSelfIntersections,
  compassDirection,
  type LatLng,
} from "./geo";

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    const p: LatLng = { lat: 47.07, lng: 15.44 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("is symmetric", () => {
    const a: LatLng = { lat: 47.07, lng: 15.44 };
    const b: LatLng = { lat: 47.08, lng: 15.45 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("matches one degree of latitude on a mean-radius sphere (~111.19km)", () => {
    const a: LatLng = { lat: 0, lng: 0 };
    const b: LatLng = { lat: 1, lng: 0 };
    // 2 * pi * EARTH_RADIUS_M / 360, using the same mean radius (6,371,000m) as haversineMeters.
    expect(haversineMeters(a, b)).toBeCloseTo(111194.93, 0);
  });
});

describe("pathLengthMeters", () => {
  it("is zero for fewer than two points", () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([{ lat: 0, lng: 0 }])).toBe(0);
  });

  it("sums consecutive segment distances", () => {
    const points: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 2, lng: 0 },
    ];
    const total = pathLengthMeters(points);
    const leg = haversineMeters(points[0], points[1]);
    expect(total).toBeCloseTo(leg * 2, 3);
  });
});

describe("estimateMinutes", () => {
  it("computes minutes from length and speed", () => {
    expect(estimateMinutes(5000, 5)).toBe(60);
  });

  it("falls back to 5 km/h for a non-positive speed", () => {
    expect(estimateMinutes(5000, 0)).toBe(60);
    expect(estimateMinutes(5000, -2)).toBe(60);
  });
});

describe("elevationStats", () => {
  it("returns null with fewer than two elevation points", () => {
    expect(elevationStats([{ lat: 0, lng: 0 }])).toBeNull();
    expect(elevationStats([{ lat: 0, lng: 0, ele: 10 }])).toBeNull();
  });

  it("computes gain/loss/min/max, ignoring points without elevation", () => {
    const points: LatLng[] = [
      { lat: 0, lng: 0, ele: 100 },
      { lat: 0, lng: 0.001 }, // no ele, skipped
      { lat: 0, lng: 0.002, ele: 120 },
      { lat: 0, lng: 0.003, ele: 90 },
    ];
    const stats = elevationStats(points);
    expect(stats).toEqual({ gainM: 20, lossM: 30, minM: 90, maxM: 120 });
  });
});

describe("reversePoints", () => {
  it("reverses order without mutating the input", () => {
    const points: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    const reversed = reversePoints(points);
    expect(reversed).toEqual([points[1], points[0]]);
    expect(points[0]).toEqual({ lat: 0, lng: 0 });
  });
});

describe("closestPointOnPath", () => {
  it("returns null for a path with fewer than two points", () => {
    expect(closestPointOnPath([], { lat: 0, lng: 0 })).toBeNull();
    expect(closestPointOnPath([{ lat: 0, lng: 0 }], { lat: 0, lng: 0 })).toBeNull();
  });

  it("finds a point exactly on a straight segment", () => {
    const path: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const midpoint: LatLng = { lat: 0, lng: 0.005 };
    const result = closestPointOnPath(path, midpoint);
    expect(result).not.toBeNull();
    expect(result!.distanceM).toBeCloseTo(0, 1);
    expect(result!.index).toBe(0);
  });

  it("clamps to the nearest endpoint when the query is beyond the path", () => {
    const path: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const beyond: LatLng = { lat: 0, lng: 0.05 };
    const result = closestPointOnPath(path, beyond);
    expect(result).not.toBeNull();
    expect(result!.point.lng).toBeCloseTo(0.01, 5);
  });
});

describe("segmentsCross", () => {
  it("detects the diagonals of a square crossing at the center", () => {
    const a1: LatLng = { lat: 0, lng: 0 };
    const a2: LatLng = { lat: 10, lng: 10 };
    const b1: LatLng = { lat: 10, lng: 0 };
    const b2: LatLng = { lat: 0, lng: 10 };
    expect(segmentsCross(a1, a2, b1, b2)).toBe(true);
  });

  it("is false for parallel, non-intersecting segments", () => {
    const a1: LatLng = { lat: 0, lng: 0 };
    const a2: LatLng = { lat: 0, lng: 10 };
    const b1: LatLng = { lat: 1, lng: 0 };
    const b2: LatLng = { lat: 1, lng: 10 };
    expect(segmentsCross(a1, a2, b1, b2)).toBe(false);
  });

  it("is false for segments that only touch at a shared endpoint", () => {
    const shared: LatLng = { lat: 5, lng: 5 };
    const a1: LatLng = { lat: 0, lng: 0 };
    const b2: LatLng = { lat: 10, lng: 0 };
    expect(segmentsCross(a1, shared, shared, b2)).toBe(false);
  });
});

describe("compassDirection", () => {
  it("maps cardinal and intercardinal bearings to the right point", () => {
    expect(compassDirection(0)).toBe("N");
    expect(compassDirection(45)).toBe("NE");
    expect(compassDirection(90)).toBe("E");
    expect(compassDirection(180)).toBe("S");
    expect(compassDirection(270)).toBe("W");
  });

  it("wraps around 360 and handles negative input", () => {
    expect(compassDirection(360)).toBe("N");
    expect(compassDirection(-45)).toBe("NW");
  });

  it("rounds to the nearest of the 8 points", () => {
    expect(compassDirection(20)).toBe("N");
    expect(compassDirection(30)).toBe("NE");
  });
});

describe("countSelfIntersections", () => {
  it("is zero for a simple, non-crossing rectangle loop", () => {
    const points: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
      { lat: 0, lng: 0 },
    ];
    expect(countSelfIntersections(points)).toBe(0);
  });

  it("counts a bowtie-shaped loop as one crossing", () => {
    const points: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 0, lng: 0 },
    ];
    expect(countSelfIntersections(points)).toBe(1);
  });
});
