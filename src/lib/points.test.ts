import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  db: {
    prepare: () => ({
      all: () => [],
    }),
  },
}));

vi.mock("./segments", () => ({
  listSegments: () => [],
}));

let computeBasePoints: typeof import("./points").computeBasePoints;
let computeRoutePointPreview: typeof import("./points").computeRoutePointPreview;
let countGoldenHits: typeof import("./points").countGoldenHits;
let celebrationTierForWalk: typeof import("./points").celebrationTierForWalk;

let computeWalkPointsEarned: typeof import("./points").computeWalkPointsEarned;

beforeAll(async () => {
  ({ computeBasePoints, computeRoutePointPreview, countGoldenHits, celebrationTierForWalk, computeWalkPointsEarned } = await import("./points"));
});

describe("computeBasePoints", () => {
  it("awards walk, distance, elevation, and exploration components", () => {
    const base = computeBasePoints([
      { length_m: 1000, segment_ids: "[]" },
      { length_m: 500, segment_ids: "[]" },
    ]);
    // 2 walks * 50 + 15 distance (1500m / 100) + 0 elevation + 0 exploration
    expect(base).toBe(115);
  });

  it("is zero for no walks", () => {
    expect(computeBasePoints([])).toBe(0);
  });
});

describe("computeRoutePointPreview", () => {
  it("includes base, golden, exploration, and diversity components", () => {
    const usageMap = new Map<number, number>([
      [1, 0],
      [2, 10],
      [3, 10],
      [4, 10],
    ]);
    const goldenMap = new Map<number, number>([[1, 3]]);
    const canonicalOf = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    const preview = computeRoutePointPreview([1, 2, 3], 2500, usageMap, goldenMap, canonicalOf);
    expect(preview.base).toBe(75);
    expect(preview.golden).toBeGreaterThan(0);
    expect(preview.exploration).toBe(8);
    expect(preview.diversity).toBeGreaterThan(0);
    expect(preview.total).toBe(preview.base + preview.golden + preview.exploration + preview.diversity);
  });
});

describe("countGoldenHits", () => {
  it("counts canonical golden segments once per route", () => {
    const goldenMap = new Map<number, number>([[5, 3]]);
    const canonicalOf = new Map<number, number>([
      [5, 5],
      [6, 5],
    ]);
    expect(countGoldenHits([5, 6, 5], goldenMap, canonicalOf)).toBe(1);
  });
});

describe("computeWalkPointsEarned", () => {
  it("applies streak multiplier to preview total", () => {
    const breakdown = { base: 75, golden: 10, exploration: 8, diversity: 5, total: 98 };
    expect(computeWalkPointsEarned(breakdown, 1.25)).toBe(123);
    expect(computeWalkPointsEarned(breakdown, 1)).toBe(98);
  });
});

describe("celebrationTierForWalk", () => {
  it("prefers golden tier when multiple golden hits", () => {
    expect(celebrationTierForWalk(2, 1, 50)).toBe("golden");
  });

  it("uses streak tier for long streaks", () => {
    expect(celebrationTierForWalk(0, 7, 50)).toBe("streak");
  });
});
