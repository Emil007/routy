import { describe, expect, it } from "vitest";
import { buildGraph, buildPairMap, searchRoutesWithConstraints, type SegmentEdge } from "./routing";
import { optimizeMustVisitOrder, tourCost, pairwiseDijkstraCosts } from "./mustVisitOrder";

/**
 * Line graph 1—2—3—4—5 (100 m / 2 min each way):
 * Tapped must-visit order [4, 2] forces a long tour; optimized [2, 4] is shorter.
 */
const LEG_M = 100;
const LEG_MIN = 2;
const lineEdges: SegmentEdge[] = [
  { id: 1, from: 1, to: 2, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 2, from: 2, to: 3, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 3, from: 3, to: 4, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 4, from: 4, to: 5, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 5, from: 2, to: 1, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 6, from: 3, to: 2, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 7, from: 4, to: 3, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 8, from: 5, to: 4, lengthM: LEG_M, durationMin: LEG_MIN },
];
const linePairs = [
  { id: 1, reverseOf: 5 },
  { id: 5, reverseOf: 1 },
  { id: 2, reverseOf: 6 },
  { id: 6, reverseOf: 2 },
  { id: 3, reverseOf: 7 },
  { id: 7, reverseOf: 3 },
  { id: 4, reverseOf: 8 },
  { id: 8, reverseOf: 4 },
];
const graph = buildGraph(lineEdges);
const pairOf = buildPairMap(linePairs);

describe("optimizeMustVisitOrder", () => {
  it("reorders must-visits so the graph tour is shorter than tap order", () => {
    const costs = pairwiseDijkstraCosts(graph, [1, 2, 4, 5], "km");
    expect(tourCost([4, 2], 1, 5, costs)).toBeGreaterThan(tourCost([2, 4], 1, 5, costs));

    const order = optimizeMustVisitOrder({
      graph,
      start: 1,
      destination: 5,
      mustVisitNodeIds: [4, 2],
      mode: "km",
    });
    expect(order).toEqual([2, 4]);
  });

  it("leaves a single must-visit unchanged", () => {
    expect(
      optimizeMustVisitOrder({
        graph,
        start: 1,
        destination: 5,
        mustVisitNodeIds: [3],
        mode: "km",
      }),
    ).toEqual([3]);
  });

  it("preserves tap order when preserveOrder is set", () => {
    expect(
      optimizeMustVisitOrder({
        graph,
        start: 1,
        destination: 5,
        mustVisitNodeIds: [4, 2],
        mode: "km",
        preserveOrder: true,
      }),
    ).toEqual([4, 2]);
  });

  it("respects excluded edges when computing visit order", () => {
    // Block 2↔3 so the only way past 2 toward 4/5 is unavailable from the left.
    // With 2↔3 excluded, 1→2 is a dead end for reaching 4; order should still
    // avoid using excluded segments in pairwise costs (legs that need 2↔3 missing).
    const excluded = new Set([2, 6]);
    const costs = pairwiseDijkstraCosts(graph, [1, 2, 4, 5], "km", excluded);
    expect(costs.has("2>4")).toBe(false);
    expect(costs.has("1>4")).toBe(false);

    const { routes, mustVisitOrder } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 5,
      mustVisitNodeIds: [2, 4],
      excludedSegmentIds: excluded,
      mode: "km",
      minValue: 0,
      maxValue: 100000,
    });
    // Unreachable under exclusion → empty pool (constraints impossible).
    expect(routes.length).toBe(0);
    // Order itself still returns the optimized attempt without inventing edges.
    expect(mustVisitOrder).toEqual([2, 4]);
  });
});

describe("searchRoutesWithConstraints must-visit order", () => {
  it("uses optimized order so the returned route is shorter than preserve-tap", () => {
    const optimized = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 5,
      mustVisitNodeIds: [4, 2],
      mode: "km",
      minValue: 0,
      maxValue: 100000,
    });
    const preserved = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 5,
      mustVisitNodeIds: [4, 2],
      mode: "km",
      minValue: 0,
      maxValue: 100000,
      preserveMustVisitOrder: true,
    });
    expect(optimized.mustVisitOrder).toEqual([2, 4]);
    expect(preserved.mustVisitOrder).toEqual([4, 2]);
    expect(optimized.routes.length).toBeGreaterThan(0);
    expect(preserved.routes.length).toBeGreaterThan(0);
    const bestOpt = Math.min(...optimized.routes.map((r) => r.lengthM));
    const bestPres = Math.min(...preserved.routes.map((r) => r.lengthM));
    expect(bestOpt).toBeLessThan(bestPres);
  });
});
