import { describe, expect, it } from "vitest";
import {
  buildGraph,
  buildPairMap,
  findDirectRoutes,
  findMultiWaypointRoutes,
  filterRequiredSegments,
  searchRoutesWithConstraints,
  backtrackScore,
  crossingScore,
  scoreRoutes,
  pickBest,
  toleranceRange,
  shapeAcceptable,
  canonicalSegmentsOf,
  immediateBacktrackCount,
  CONDITION_PENALTY_WEIGHT,
  type SegmentEdge,
} from "./routing";
import type { LatLng } from "./geo";

/**
 * A 4-node square loop, 100m/2min per leg, each leg with its automatic reverse
 * counterpart — mirrors how `createSegmentWithReverse` stores real paths.
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

describe("buildGraph", () => {
  it("groups edges by their start node", () => {
    const graph = buildGraph(edges);
    expect(graph.adjacency.get(1)?.map((e) => e.id).sort()).toEqual([1, 8]);
    expect(graph.adjacency.get(2)?.map((e) => e.id).sort()).toEqual([2, 5]);
  });
});

describe("buildPairMap", () => {
  it("maps each segment to its reverse in both directions", () => {
    const pairOf = buildPairMap(reversePairs);
    expect(pairOf.get(1)).toBe(5);
    expect(pairOf.get(5)).toBe(1);
    expect(pairOf.get(4)).toBe(8);
  });
});

describe("findDirectRoutes", () => {
  const graph = buildGraph(edges);
  const pairOf = buildPairMap(reversePairs);

  it("finds a full loop back to the start within range", () => {
    const results = findDirectRoutes(graph, pairOf, 1, 1, "km", 300, 500);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.nodeChain[0]).toBe(1);
      expect(r.nodeChain[r.nodeChain.length - 1]).toBe(1);
      expect(r.lengthM).toBeGreaterThanOrEqual(300);
      expect(r.lengthM).toBeLessThanOrEqual(500);
    }
  });

  it("never immediately reverses onto the edge just travelled when an alternative exists", () => {
    const results = findDirectRoutes(graph, pairOf, 1, 1, "km", 300, 500);
    for (const r of results) {
      for (let i = 1; i < r.segmentIds.length; i++) {
        expect(pairOf.get(r.segmentIds[i - 1])).not.toBe(r.segmentIds[i]);
      }
    }
  });

  it("returns nothing when the range can't be satisfied", () => {
    const results = findDirectRoutes(graph, pairOf, 1, 1, "km", 10000, 20000);
    expect(results).toEqual([]);
  });
});

describe("backtrackScore", () => {
  const pairOf = buildPairMap(reversePairs);

  it("is zero for a route that never repeats a physical path", () => {
    expect(backtrackScore([1, 2, 3, 4], pairOf)).toBe(0);
  });

  it("counts an out-and-back (forward then its own reverse) as a repeat", () => {
    // 1 -> 2 -> 1, i.e. edge 1 then its reverse edge 5: same physical path twice.
    expect(backtrackScore([1, 5], pairOf)).toBe(1);
  });
});

describe("crossingScore", () => {
  it("is zero when the route's geometry never crosses itself", () => {
    const geometryOf = new Map<number, LatLng[]>([
      [1, [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }]],
      [2, [{ lat: 0, lng: 10 }, { lat: 10, lng: 10 }]],
      [3, [{ lat: 10, lng: 10 }, { lat: 10, lng: 0 }]],
      [4, [{ lat: 10, lng: 0 }, { lat: 0, lng: 0 }]],
    ]);
    expect(crossingScore([1, 2, 3, 4], geometryOf)).toBe(0);
  });

  it("counts a bowtie-shaped route as one crossing", () => {
    const geometryOf = new Map<number, LatLng[]>([
      [11, [{ lat: 0, lng: 0 }, { lat: 10, lng: 10 }]],
      [12, [{ lat: 10, lng: 10 }, { lat: 10, lng: 0 }]],
      [13, [{ lat: 10, lng: 0 }, { lat: 0, lng: 10 }]],
      [14, [{ lat: 0, lng: 10 }, { lat: 0, lng: 0 }]],
    ]);
    expect(crossingScore([11, 12, 13, 14], geometryOf)).toBe(1);
  });
});

describe("scoreRoutes + pickBest", () => {
  it("prefers the loop with the lowest backtrack score", () => {
    const graph = buildGraph(edges);
    const pairOf = buildPairMap(reversePairs);
    const candidates = [
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
      { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
    ];
    const scored = scoreRoutes(candidates, pairOf, new Map(), new Map(), 1, new Set(), 400, "km");
    const best = pickBest(scored, new Set());
    expect(best?.route.segmentIds).toEqual([1, 2, 3, 4]);
    // sanity: graph is only used to build the candidates above, not re-derived here
    expect(graph.adjacency.size).toBeGreaterThan(0);
  });

  it("prefers the loop with fewer self-crossings when backtrack scores tie", () => {
    const geometryOf = new Map<number, LatLng[]>([
      [1, [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }]],
      [2, [{ lat: 0, lng: 10 }, { lat: 10, lng: 10 }]],
      [3, [{ lat: 10, lng: 10 }, { lat: 10, lng: 0 }]],
      [4, [{ lat: 10, lng: 0 }, { lat: 0, lng: 0 }]],
      [11, [{ lat: 0, lng: 0 }, { lat: 10, lng: 10 }]],
      [12, [{ lat: 10, lng: 10 }, { lat: 10, lng: 0 }]],
      [13, [{ lat: 10, lng: 0 }, { lat: 0, lng: 10 }]],
      [14, [{ lat: 0, lng: 10 }, { lat: 0, lng: 0 }]],
    ]);
    const candidates = [
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [11, 12, 13, 14], lengthM: 400, durationMin: 8 },
    ];
    const scored = scoreRoutes(candidates, new Map(), new Map(), new Map(), 1, new Set(), 400, "km", geometryOf);
    expect(scored[0].backtrack).toBe(scored[1].backtrack);
    const best = pickBest(scored, new Set());
    expect(best?.route.segmentIds).toEqual([1, 2, 3, 4]);
  });

  it("counts never-walked segments in unexplored score", () => {
    const candidates = [
      { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
    ];
    const usage = new Map<number, number>([[1, 2]]);
    const scored = scoreRoutes(candidates, new Map(), usage, new Map(), 1, new Set(), 200, "km");
    expect(scored[0].unexplored).toBe(1);
  });

  it("prefers more unexplored segments in explorer mode even when shape scores tie", () => {
    const scored = [
      {
        key: "a",
        route: { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
        backtrack: 0,
        crossing: 0,
        weightedUsage: 0,
        overlap: 0,
        delta: 0,
        unexplored: 1,
        avoidPenalty: 0,
        conditionPenalty: 0,
        staleCount: 0,
        pointPreview: 0,
        homeConnectors: 0,
      },
      {
        key: "b",
        route: { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
        backtrack: 0,
        crossing: 0,
        weightedUsage: 0,
        overlap: 0,
        delta: 0,
        unexplored: 4,
        avoidPenalty: 0,
        conditionPenalty: 0,
        staleCount: 0,
        pointPreview: 0,
        homeConnectors: 0,
      },
    ];
    const normal = pickBest(scored, new Set(), false);
    expect(normal?.key).toBe("a");
    const explorer = pickBest(scored, new Set(), true);
    expect(explorer?.key).toBe("b");
  });

  it("prefers routes with fewer avoided segments when shape scores tie", () => {
    const candidates = [
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
      { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
    ];
    const scored = scoreRoutes(candidates, new Map(), new Map(), new Map(), 1, new Set(), 400, "km", new Map(), new Set([5]));
    expect(scored[1].avoidPenalty).toBe(25);
    const best = pickBest(scored, new Set());
    expect(best?.route.segmentIds).toEqual([1, 2, 3, 4]);
  });

  it("prefers routes with lower condition penalty after avoid penalty ties", () => {
    const candidates = [
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
      { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
    ];
    const conditionCounts = new Map<number, number>([[5, 1]]);
    const scored = scoreRoutes(candidates, new Map(), new Map(), new Map(), 1, new Set(), 400, "km", new Map(), new Set(), conditionCounts);
    expect(scored[1].conditionPenalty).toBe(CONDITION_PENALTY_WEIGHT);
    const best = pickBest(scored, new Set());
    expect(best?.route.segmentIds).toEqual([1, 2, 3, 4]);
  });

  it("(L6) generation prefers a single home connector over using both house paths", () => {
    // Home node 1 has two distinct physical connectors: {1,5} (1↔2) and {4,8} (1↔4).
    const pairOf = buildPairMap(reversePairs);
    const home = new Set([1, 5, 4, 8]);
    const candidates = [
      // Out-and-back on ONE connector (1↔2): both segments are home connectors.
      { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
      // Clean square loop, but it leaves via connector {1} and returns via connector {4}.
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
    ];
    const scoredIgnore = scoreRoutes(
      candidates,
      pairOf,
      new Map(),
      new Map(),
      1,
      new Set(),
      400,
      "km",
      new Map(),
      new Set(),
      new Map(),
      new Set(),
      new Map(),
      home,
    );
    const single = scoredIgnore.find((s) => s.route.segmentIds.join(",") === "1,5")!;
    const both = scoredIgnore.find((s) => s.route.segmentIds.join(",") === "1,2,3,4")!;
    expect(single.homeConnectors).toBe(1);
    expect(both.homeConnectors).toBe(2);
    // With home edges ignored for scoring, the single-connector option wins (L6).
    expect(pickBest(scoredIgnore, new Set())?.route.segmentIds).toEqual([1, 5]);
    // Without ignoring home edges, the out-and-back's backtrack makes the loop win instead.
    const scoredFull = scoreRoutes(candidates, pairOf, new Map(), new Map(), 1, new Set(), 400, "km");
    expect(pickBest(scoredFull, new Set())?.route.segmentIds).toEqual([1, 2, 3, 4]);
  });

  it("counts stale segments once per physical path", () => {
    const pairOf = new Map<number, number>([
      [1, 2],
      [2, 1],
    ]);
    const candidates = [
      { nodeChain: [1, 3, 1], segmentIds: [1, 2], lengthM: 400, durationMin: 8 },
    ];
    const staleSegmentIds = new Set([1, 2]);
    const scored = scoreRoutes(
      candidates,
      pairOf,
      new Map(),
      new Map(),
      0,
      new Set(),
      400,
      "km",
      new Map(),
      new Set(),
      new Map(),
      staleSegmentIds,
    );
    expect(scored[0]?.staleCount).toBe(1);
  });

  it("prefers more stale segments in surprise mode", () => {
    const scored = [
      {
        key: "a",
        route: { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
        backtrack: 0,
        crossing: 0,
        weightedUsage: 0,
        overlap: 0,
        delta: 0,
        unexplored: 0,
        avoidPenalty: 0,
        conditionPenalty: 0,
        staleCount: 1,
        pointPreview: 0,
        homeConnectors: 0,
      },
      {
        key: "b",
        route: { nodeChain: [1, 2, 1], segmentIds: [1, 5], lengthM: 200, durationMin: 4 },
        backtrack: 0,
        crossing: 0,
        weightedUsage: 0,
        overlap: 0,
        delta: 0,
        unexplored: 0,
        avoidPenalty: 0,
        conditionPenalty: 0,
        staleCount: 3,
        pointPreview: 0,
        homeConnectors: 0,
      },
    ];
    const normal = pickBest(scored, new Set(), false, false);
    expect(normal?.key).toBe("a");
    const surprise = pickBest(scored, new Set(), false, true);
    expect(surprise?.key).toBe("b");
  });
});

describe("toleranceRange", () => {
  it("computes a symmetric range around the target", () => {
    expect(toleranceRange(1000, 10)).toEqual({ minValue: 900, maxValue: 1100 });
  });

  it("never goes below zero", () => {
    expect(toleranceRange(50, 200)).toEqual({ minValue: 0, maxValue: 150 });
  });
});

describe("findMultiWaypointRoutes + constraints", () => {
  const graph = buildGraph(edges);
  const pairOf = buildPairMap(reversePairs);

  it("chains start → waypoint → destination", () => {
    const results = findMultiWaypointRoutes(graph, pairOf, 1, [3], 1, "km", 300, 500);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.nodeChain[0]).toBe(1);
      expect(r.nodeChain).toContain(3);
      expect(r.nodeChain[r.nodeChain.length - 1]).toBe(1);
    }
  });

  it("hard-excludes directed segments from search", () => {
    const withExclude = findDirectRoutes(graph, pairOf, 1, 1, "km", 300, 500, 50, new Set([1, 5]));
    for (const r of withExclude) {
      expect(r.segmentIds).not.toContain(1);
      expect(r.segmentIds).not.toContain(5);
    }
  });

  it("filters to routes containing required segments", () => {
    const open = findDirectRoutes(graph, pairOf, 1, 1, "km", 300, 500);
    const filtered = filterRequiredSegments(open, [2], pairOf);
    expect(filtered.length).toBeGreaterThan(0);
    for (const r of filtered) {
      expect(r.segmentIds.includes(2) || r.segmentIds.includes(6)).toBe(true);
    }
  });

  it("length-relaxes when the band is empty but a feasible route exists", () => {
    const { routes, lengthRelaxed } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      mode: "km",
      minValue: 10000,
      maxValue: 20000,
    });
    expect(lengthRelaxed).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]!.lengthM).toBeLessThan(10000);
  });

  it("ignoring home-access segments does not change pickBest vs an otherwise identical ranking", () => {
    // Both candidates share the same home connector (1); the rest of the network differs.
    const candidates = [
      { nodeChain: [1, 2, 3, 4, 1], segmentIds: [1, 2, 3, 4], lengthM: 400, durationMin: 8 },
      { nodeChain: [1, 2, 3, 2, 1], segmentIds: [1, 2, 6, 5], lengthM: 400, durationMin: 8 },
    ];
    const usage = new Map<number, number>([
      [1, 99],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
    ]);
    const home = new Set([1, 5]);
    const scoredFull = scoreRoutes(candidates, pairOf, usage, new Map(), 1, new Set(), 400, "km");
    const scoredIgnore = scoreRoutes(
      candidates,
      pairOf,
      usage,
      new Map(),
      1,
      new Set(),
      400,
      "km",
      new Map(),
      new Set(),
      new Map(),
      new Set(),
      new Map(),
      home,
    );
    // Clean loop wins either way (backtrack on 2↔6 still counts when home edges are ignored).
    expect(pickBest(scoredFull, new Set())?.route.segmentIds).toEqual([1, 2, 3, 4]);
    expect(pickBest(scoredIgnore, new Set())?.route.segmentIds).toEqual([1, 2, 3, 4]);
    const fullLoop = scoredFull.find((s) => s.route.segmentIds.join(",") === "1,2,3,4")!;
    const ignoreLoop = scoredIgnore.find((s) => s.route.segmentIds.join(",") === "1,2,3,4")!;
    expect(ignoreLoop.weightedUsage).toBeLessThan(fullLoop.weightedUsage);
  });
});

/**
 * Regression guarantees for the constrained-tour fixes (2026-10-27 night session):
 *  - must-visits in a small network must NOT collapse to a single candidate when
 *    the only clean (no-backtrack) route can't fill the band — shape-relaxed
 *    candidates are kept so the UI has choice;
 *  - pickBest(..., allowRepeats=true) never hard-fails ("keine Route") once the
 *    seenKeys pool is exhausted.
 */
describe("constrained tour diversity + repeats", () => {
  // Network: a 6-node grid, 100m legs in both directions:
  //   1-2-3
  //   | | |
  //   4-5-6
  const gridEdges: SegmentEdge[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((id) => {
    const pairs: Record<number, [number, number]> = {
      1: [1, 2], 2: [2, 3], 3: [1, 4], 4: [2, 5], 5: [3, 6], 6: [4, 5], 7: [5, 6],
    };
    const rev: Record<number, [number, number]> = {
      8: [2, 1], 9: [3, 2], 10: [4, 1], 11: [5, 2], 12: [6, 3], 13: [5, 4], 14: [6, 5],
    };
    const [from, to] = pairs[id] ?? rev[id]!;
    return { id, from, to, lengthM: LEG_M, durationMin: LEG_MIN } as SegmentEdge;
  });
  const gridReverse = gridEdges.map((e) => {
    const rev = e.id <= 7 ? e.id + 7 : e.id - 7;
    return { id: e.id, reverseOf: rev };
  });
  const gridGraph = buildGraph(gridEdges);
  const gridPair = buildPairMap(gridReverse);

  it("constrained tour with must-visit [2,6] returns multiple distinct candidates (not 1-2)", () => {
    const { routes } = searchRoutesWithConstraints({
      graph: gridGraph,
      pairOf: gridPair,
      start: 1,
      destination: 1,
      mustVisitNodeIds: [2, 6],
      mode: "km",
      minValue: 300,
      maxValue: 900,
    });
    const uniq = new Set(routes.map((r) => r.segmentIds.join(",")));
    expect(uniq.size).toBeGreaterThanOrEqual(3);
  });

  it("pickBest(allowRepeats) returns a route even when every candidate is seen", () => {
    const candidates = [
      { nodeChain: [1, 2, 3, 1], segmentIds: [1, 2, 9], lengthM: 300, durationMin: 6 },
      { nodeChain: [1, 4, 5, 1], segmentIds: [3, 6, 10], lengthM: 300, durationMin: 6 },
    ];
    const usage = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [9, 0], [10, 0]]);
    const scored = scoreRoutes(candidates, gridPair, usage, new Map(), 1, new Set(), 400, "km");

    const seenAll = new Set(scored.map((s) => s.key));
    const withRepeats = pickBest(scored, seenAll, false, false, true, true);
    expect(withRepeats).not.toBeNull();

    const noRepeats = pickBest(scored, seenAll);
    expect(noRepeats).toBeNull();
  });
});

/**
 * Emanuel's backtracking rules (2026-10-27):
 *  - immediate out-and-back on the same physical path is only OK on a true dead end;
 *  - no physical path more than once per direction (max 2 traversals total);
 *  - home connectors are exempt from all shape rules.
 */
describe("backtracking shape rules (Emanuel 2026-10-27)", () => {
  // Line: 1--(a,b)-->2--(c)-->3, where 3 is a dead-end spur; and 2--(d)-->4 loop back to 1.
  //   ids: 1:1->2, 2:2->1, 3:2->3, 4:3->2 (spur pair), 5:2->4, 6:4->1, 7:1->4, 8:4->2 (loop pair)
  // Segment layout (directed pairs):
  //   home path: 1:1->2 and 2:2->1 (reverseOf each other)
  //   spur path: 3:2->3 and 4:3->2 (reverseOf each other)
  //   loop out : 5:2->4 and 6:4->2 (reverseOf)
  //   loop back: 7:4->1 and 8:1->4 (reverseOf)
  const spurEdges: SegmentEdge[] = [
    { id: 1, from: 1, to: 2, lengthM: 100, durationMin: 2 },
    { id: 2, from: 2, to: 1, lengthM: 100, durationMin: 2 },
    { id: 3, from: 2, to: 3, lengthM: 80, durationMin: 2 }, // spur out
    { id: 4, from: 3, to: 2, lengthM: 80, durationMin: 2 }, // spur back
    { id: 5, from: 2, to: 4, lengthM: 120, durationMin: 2 },
    { id: 6, from: 4, to: 2, lengthM: 120, durationMin: 2 },
    { id: 7, from: 4, to: 1, lengthM: 120, durationMin: 2 },
    { id: 8, from: 1, to: 4, lengthM: 120, durationMin: 2 },
  ];
  const spurReverse = [
    { id: 1, reverseOf: 2 }, { id: 2, reverseOf: 1 },
    { id: 3, reverseOf: 4 }, { id: 4, reverseOf: 3 },
    { id: 5, reverseOf: 6 }, { id: 6, reverseOf: 5 },
    { id: 7, reverseOf: 8 }, { id: 8, reverseOf: 7 },
  ];
  const spurGraph = buildGraph(spurEdges);
  const spurPair = buildPairMap(spurReverse);

  it("accepts immediate out-and-back on a dead end (spur) but rejects it elsewhere", () => {
    // 1->2 (id1) then 2->1 (id2) immediate reverse: node 2 is NOT a dead end → rejected.
    expect(shapeAcceptable([1, 2], [1, 2, 1], spurPair, spurGraph)).toBe(false);

    // 2->3 (id3) then 3->2 (id4): node 3 IS a dead end (only path incident) → OK.
    expect(shapeAcceptable([3, 4], [2, 3, 2], spurPair, spurGraph)).toBe(true);
  });

  it("rejects a physical path walked more than once per direction", () => {
    // Home path {1,2} traversed 1,2,1,2 = 4 total (2× each direction) → reject.
    expect(
      shapeAcceptable([1, 2, 1, 2], [1, 2, 1, 2, 1], spurPair, spurGraph),
    ).toBe(false);
    // Clean loop that never repeats a path: 1->2 (1), 2->4 (5), 4->1 (7)
    // = canonical {1,2}, {5,6}, {7,8} each once → acceptable.
    expect(shapeAcceptable([1, 5, 7], [1, 2, 4, 1], spurPair, spurGraph)).toBe(true);
  });

  it("exempts home connectors from the backtrack rules", () => {
    const homeCanonical = canonicalSegmentsOf([1, 2], spurPair); // canonical {1,2}
    // Leaving home on {1,2} and returning counts as backtrack without the ignore…
    expect(backtrackScore([1, 2], spurPair)).toBe(1);
    // …and is exempt when home is passed as an ignore set.
    expect(backtrackScore([1, 2], spurPair, homeCanonical)).toBe(0);
    // And a route built from the home connector out-and-back passes the shape check
    // when the connector is exempt (it would otherwise be immediate backtracking).
    expect(shapeAcceptable([1, 2], [1, 2, 1], spurPair, spurGraph, homeCanonical)).toBe(true);
    expect(homeCanonical.has(1)).toBe(true);
  });
});
