import { describe, expect, it } from "vitest";
import type { ScoredRoute } from "./routing";
import { routeQualityFromScored } from "./routeQuality";

function scored(partial: Partial<ScoredRoute> & Pick<ScoredRoute, "route">): ScoredRoute {
  return {
    key: "k",
    backtrack: 0,
    crossing: 0,
    weightedUsage: 0,
    overlap: 0,
    delta: 0,
    unexplored: 0,
    avoidPenalty: 0,
    conditionPenalty: 0,
    staleCount: 0,
    pointPreview: 0,
    homeConnectors: 0,
    ...partial,
  };
}

describe("routeQualityFromScored", () => {
  it("copies length, backtrack, crossing, homeConnectors, unexplored", () => {
    const q = routeQualityFromScored(
      scored({
        route: { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
        backtrack: 2,
        crossing: 1,
        homeConnectors: 3,
        unexplored: 4,
      }),
    );
    expect(q).toEqual({
      lengthM: 200,
      backtrack: 2,
      crossing: 1,
      homeConnectors: 3,
      unexplored: 4,
    });
  });

  it("moves in the expected direction when backtrack / homeConnectors change", () => {
    const clean = routeQualityFromScored(
      scored({
        route: { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
        backtrack: 0,
        homeConnectors: 1,
      }),
    );
    const messy = routeQualityFromScored(
      scored({
        route: { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
        backtrack: 1,
        homeConnectors: 2,
      }),
    );
    expect(messy.backtrack).toBeGreaterThan(clean.backtrack);
    expect(messy.homeConnectors).toBeGreaterThan(clean.homeConnectors);
  });
});
