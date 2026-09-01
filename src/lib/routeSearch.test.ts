import { describe, expect, it } from "vitest";
import { buildGraph, buildPairMap, searchRoutesWithConstraints, type SegmentEdge } from "./routing";
import { dijkstra, generateRoutePool } from "./routeSearch";

/**
 * Same 4-node square loop as routing.test.ts (100m/2min per leg, each with its reverse):
 *   1 -(1)-> 2 -(2)-> 3 -(3)-> 4 -(4)-> 1
 *   1 <-(8)- 4 <-(7)- 3 <-(6)- 2 <-(5)- 1
 */
const LEG_M = 100;
const LEG_MIN = 2;
const edges: SegmentEdge[] = [
  { id: 1, from: 1, to: 2, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 2, from: 2, to: 3, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 3, from: 3, to: 4, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 4, from: 4, to: 1, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 5, from: 2, to: 1, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 6, from: 3, to: 2, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 7, from: 4, to: 3, lengthM: LEG_M, durationMin: LEG_MIN },
  { id: 8, from: 1, to: 4, lengthM: LEG_M, durationMin: LEG_MIN },
];
const reversePairs = [
  { id: 1, reverseOf: 5 },
  { id: 5, reverseOf: 1 },
  { id: 2, reverseOf: 6 },
  { id: 6, reverseOf: 2 },
  { id: 3, reverseOf: 7 },
  { id: 7, reverseOf: 3 },
  { id: 4, reverseOf: 8 },
  { id: 8, reverseOf: 4 },
];

const graph = buildGraph(edges);
const pairOf = buildPairMap(reversePairs);

describe("dijkstra", () => {
  it("finds the shortest directed path between two nodes", () => {
    const r = dijkstra(graph, 1, 3, "km");
    expect(r).not.toBeNull();
    expect(r!.lengthM).toBe(200);
    expect(r!.nodeChain[0]).toBe(1);
    expect(r!.nodeChain[r!.nodeChain.length - 1]).toBe(3);
  });

  it("returns the empty route when start === goal", () => {
    const r = dijkstra(graph, 1, 1, "km");
    expect(r).toEqual({ nodeChain: [1], segmentIds: [], lengthM: 0, durationMin: 0 });
  });

  it("routes around hidden/excluded edges", () => {
    const r = dijkstra(graph, 1, 2, "km", new Set([1]));
    expect(r).not.toBeNull();
    expect(r!.segmentIds).not.toContain(1);
    // Only way left to reach 2 is the long way round: 1→4→3→2.
    expect(r!.lengthM).toBe(300);
  });
});

describe("generateRoutePool", () => {
  it("closes a loop back to start when only required segments are set", () => {
    const pool = generateRoutePool({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      mustVisitNodeIds: [],
      requiredSegmentIds: [2],
      excludedSegmentIds: new Set(),
      mode: "km",
      minValue: 0,
      maxValue: 10000,
    });
    expect(pool.length).toBeGreaterThan(0);
    const r = pool[0]!;
    expect(r.nodeChain[0]).toBe(1);
    expect(r.nodeChain[r.nodeChain.length - 1]).toBe(1);
    expect(r.segmentIds.includes(2) || r.segmentIds.includes(6)).toBe(true);
  });

  it("builds genuine (non-retracing) loops for a start === destination request", () => {
    const pool = generateRoutePool({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      mustVisitNodeIds: [],
      requiredSegmentIds: [],
      excludedSegmentIds: new Set(),
      mode: "km",
      minValue: 0,
      maxValue: 10000,
    });
    expect(pool.length).toBeGreaterThan(0);
    const clean = pool.find((r) => r.segmentIds.length === 4);
    expect(clean).toBeDefined();
    // A clean square loop starts and ends at home.
    expect(clean!.nodeChain[0]).toBe(1);
    expect(clean!.nodeChain[clean!.nodeChain.length - 1]).toBe(1);
  });
});

describe("searchRoutesWithConstraints (Dijkstra engine)", () => {
  it("(L8a) finds a route with 2 must-visits + 1 required segment", () => {
    const { routes } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      mustVisitNodeIds: [2, 3],
      requiredSegmentIds: [3],
      mode: "km",
      minValue: 0,
      maxValue: 100000,
    });
    expect(routes.length).toBeGreaterThan(0);
    const withAll = routes.find(
      (r) =>
        r.nodeChain.includes(2) &&
        r.nodeChain.includes(3) &&
        (r.segmentIds.includes(3) || r.segmentIds.includes(7)),
    );
    expect(withAll).toBeDefined();
  });

  it("(L8b) relaxes the length band instead of hard-failing when a feasible path exists", () => {
    const { routes, lengthRelaxed } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      requiredSegmentIds: [2],
      mode: "km",
      minValue: 10000,
      maxValue: 20000,
    });
    expect(lengthRelaxed).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    // Feasible route is far shorter than the impossible 10–20 km band.
    expect(routes[0]!.lengthM).toBeLessThan(10000);
    // Required segment (2, or its reverse 6) is still present after relaxing.
    expect(routes[0]!.segmentIds.includes(2) || routes[0]!.segmentIds.includes(6)).toBe(true);
  });

  it("excludes hard-dropped segments from the shortest-path pool", () => {
    const { routes } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      excludedSegmentIds: new Set([1, 5]),
      mode: "km",
      minValue: 0,
      maxValue: 100000,
    });
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.segmentIds).not.toContain(1);
      expect(r.segmentIds).not.toContain(5);
    }
  });
});
