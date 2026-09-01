import { describe, expect, it } from "vitest";
import { buildGraph, type SegmentEdge } from "./routing";
import { buildGuideRoute } from "./guideRoute";

describe("buildGuideRoute", () => {
  const connected: SegmentEdge[] = [
    { id: 1, from: 1, to: 2, lengthM: 100, durationMin: 2 },
    { id: 2, from: 2, to: 3, lengthM: 100, durationMin: 2 },
    { id: 3, from: 3, to: 1, lengthM: 100, durationMin: 2 },
  ];
  const connectedGraph = buildGraph(connected);

  it("builds a loop through reachable nodes", () => {
    const route = buildGuideRoute(connectedGraph, [1, 2, 3], true);
    expect(route).not.toBeNull();
    expect(route!.lengthM).toBeGreaterThan(0);
    expect(route!.nodeChain[0]).toBe(1);
  });

  it("returns null when a leg is unreachable", () => {
    const disconnected: SegmentEdge[] = [
      { id: 1, from: 1, to: 2, lengthM: 100, durationMin: 2 },
      { id: 2, from: 3, to: 4, lengthM: 100, durationMin: 2 },
    ];
    const graph = buildGraph(disconnected);
    expect(buildGuideRoute(graph, [1, 4], false)).toBeNull();
  });
});
