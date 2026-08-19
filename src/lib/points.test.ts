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

beforeAll(async () => {
  ({ computeBasePoints } = await import("./points"));
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
