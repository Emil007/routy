// Routing regression — ANONYMIZED SYNTHETIC FIXTURE (decision D).
//
// The old version depended on a private GPS backup DB (data/routy-2026-08-31.db)
// that must never be committed — home nodes + GPS traces are a privacy leak. It
// also meant the test CONSTANTLY SKIPPED on every checkout that lacked the file.
//
// This fixture is a synthetic, anonymous grid network declared inline. It has no
// real coordinates (all lat/lng are placeholders on a clean orthogonal grid) and
// exercises the same production invariants end-to-end: generate a constrained
// short route, then verify it is clean (no backtrack / no crossing), stays in
// its length band, and actually visits the required segments.
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  buildPairMap,
  searchRoutesWithConstraints,
  scoreRoutes,
  pickBest,
  backtrackScore,
  crossingScore,
  filterRequiredSegments,
  type SegmentEdge,
} from "./routing";
import type { LatLng } from "./geo";

// Anonymous orthogonal grid, 6×4, ~100 m spacing. Nodes 1..24.
//  1  2  3  4  5  6
//  7  8  9 10 11 12
// 13 14 15 16 17 18
// 19 20 21 22 23 24
// Every unit edge (h + v) gets a forward id and its automatic reverse id.
const W = 6;
const H = 4;
const SPACING = 100; // metres, also used as the "duration" in centiminutes-ish units
function xy(n: number): { x: number; y: number } {
  const x = (n - 1) % W;
  const y = Math.floor((n - 1) / W);
  return { x, y };
}
function geo(n: number): LatLng {
  // Placeholder coordinates on a synthetic plane around 0,0 — NOT a real area.
  const { x, y } = xy(n);
  return { lat: y * 0.0009, lng: x * 0.0012 };
}

function buildFlatGrid(): { edges: SegmentEdge[]; reversePairs: { id: number; reverseOf: number }[] } {
  const edges: SegmentEdge[] = [];
  const reversePairs: { id: number; reverseOf: number; forwardId: number }[] = [];
  let nextId = 1;
  const addPair = (from: number, to: number) => {
    const fwd = nextId++;
    const rev = nextId++;
    edges.push({ id: fwd, from, to, lengthM: SPACING, durationMin: 1 });
    edges.push({ id: rev, from: to, to: from, lengthM: SPACING, durationMin: 1 });
    reversePairs.push({ id: fwd, reverseOf: rev, forwardId: fwd });
    reversePairs.push({ id: rev, reverseOf: fwd, forwardId: fwd });
  };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W - 1; c++) {
      const a = r * W + (c + 1);
      const b = a + 1;
      addPair(a, b);
    }
  }
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H - 1; r++) {
      const a = r * W + (c + 1);
      const b = a + W;
      addPair(a, b);
    }
  }
  return { edges, reversePairs: reversePairs.map(({ id, reverseOf }) => ({ id, reverseOf })) };
}

const { edges, reversePairs } = buildFlatGrid();
const graph = buildGraph(edges);
const pairOf = buildPairMap(reversePairs);
const geometryOf = new Map<number, LatLng[]>();
for (const e of edges) {
  geometryOf.set(e.id, [geo(e.from), geo(e.to)]);
}

// helper to compute canonical id for a directed pair (mirrors canonicalSegmentId).
function canonicalId(id: number): number {
  const pair = pairOf.get(id);
  return pair !== undefined ? Math.min(id, pair) : id;
}

describe("routing regression (synthetic anonymous grid)", () => {
  it("a constrained short loop (required segments) is clean and in-band, not a ~2× detour", () => {
    // Force a specific physical path to be used: edge from node 1→2 (find its
    // forward id empirically) plus a far-away one. Inside the grid the required
    // segment pair pins part of a perimeter loop.
    const start = 1; // top-left corner
    const homeNodeId = 1;
    const requiredForward1 = edges.find((e) => e.from === 1 && e.to === 2)!.id;
    const requiredForward2 = edges.find((e) => e.from === 19 && e.to === 20)!.id;
    const required = [requiredForward1, requiredForward2];

    // A short loop ~ 12 units (perimeter of a 3×2 sub-grid).
    const { routes, lengthRelaxed } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start,
      destination: homeNodeId,
      requiredSegmentIds: required,
      mode: "km",
      minValue: 10 * SPACING,
      maxValue: 14 * SPACING,
      geometryOf,
    });

    expect(lengthRelaxed).toBe(false);
    expect(routes.length).toBeGreaterThan(0);

    // Verify constraints were kept: every candidate includes the required
    // physical paths (either direction).
    const feasible = filterRequiredSegments(routes, required, pairOf);
    expect(feasible.length).toBe(routes.length);

    const scored = scoreRoutes(
      routes,
      pairOf,
      new Map(),
      new Map(),
      1,
      new Set(),
      12 * SPACING,
      "km",
      geometryOf,
    );
    const best = pickBest(scored, new Set());
    expect(best).not.toBeNull();

    // Clean shape — no immediate out-and-back, no self-crossing.
    expect(backtrackScore(best!.route.segmentIds, pairOf)).toBe(0);
    expect(crossingScore(best!.route.segmentIds, geometryOf)).toBe(0);

    // In-band (or at most one relax step when the band is empty — it isn't here).
    expect(best!.route.lengthM).toBeGreaterThanOrEqual(8 * SPACING);
    expect(best!.route.lengthM).toBeLessThanOrEqual(16 * SPACING);

    // It actually uses the required physical paths.
    const ids = new Set(best!.route.segmentIds);
    expect(ids.has(requiredForward1) || pairOf.has(requiredForward1) && ids.has(pairOf.get(requiredForward1)!)).toBe(true);
    expect(ids.has(requiredForward2) || pairOf.has(requiredForward2) && ids.has(pairOf.get(requiredForward2)!)).toBe(true);
  });

  it("picks the shortest clean route when required segments force a choice (no inflated detour)", () => {
    // Two distinct candidate corridors exist; the scorer must prefer the shorter
    // clean one that still contains both required physical paths. Compare the
    // chosen length against the true shortest feasible length.
    const requiredForward1 = edges.find((e) => e.from === 1 && e.to === 7)!.id; // left column, 1→7
    const requiredForward2 = edges.find((e) => e.from === 18 && e.to === 24)!.id; // 18→24

    const { routes } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      requiredSegmentIds: [requiredForward1, requiredForward2],
      mode: "km",
      minValue: 0,
      maxValue: 100 * SPACING,
      geometryOf,
    });
    expect(routes.length).toBeGreaterThan(0);

    const cleanFeasible = filterRequiredSegments(routes, [requiredForward1, requiredForward2], pairOf).filter(
      (r) => backtrackScore(r.segmentIds, pairOf) === 0 && crossingScore(r.segmentIds, geometryOf) === 0,
    );
    expect(cleanFeasible.length).toBeGreaterThan(0);
    const minClean = Math.min(...cleanFeasible.map((r) => r.lengthM));

    const scored = scoreRoutes(routes, pairOf, new Map(), new Map(), 1, new Set(), minClean, "km", geometryOf);
    const best = pickBest(scored, new Set());
    expect(best).not.toBeNull();
    // The best must be no more than a small tolerance above the true minimum.
    expect(best!.route.lengthM).toBeLessThanOrEqual(minClean + 2 * SPACING);
  });

  it("must-visits stay in node chain even under relaxation (defensive invariant)", () => {
    const mustVisit = [13, 22]; // two interior nodes
    const { routes, lengthRelaxed } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: 1,
      destination: 1,
      mustVisitNodeIds: mustVisit,
      mode: "km",
      minValue: 3 * SPACING, // deliberately tiny band → forces relaxation
      maxValue: 4 * SPACING,
      geometryOf,
    });
    expect(routes.length).toBeGreaterThan(0);
    // Even a relaxed route must chain every must-visit node.
    for (const r of routes) {
      const on = new Set(r.nodeChain);
      expect(mustVisit.every((n) => on.has(n))).toBe(true);
    }
    // It should have used relaxation (band was impossible), not produced garbage.
    if (lengthRelaxed) {
      expect(routes[0]!.lengthM).toBeGreaterThan(4 * SPACING);
    }
  });

  it("canonical id mapping is consistent with the grid (sanity)", () => {
    const fwd = edges.find((e) => e.from === 1 && e.to === 2)!.id;
    const rev = pairOf.get(fwd)!;
    expect(canonicalId(fwd)).toBe(canonicalId(rev));
    expect(canonicalId(fwd)).toBeLessThanOrEqual(fwd);
    expect(canonicalId(rev)).toBeLessThanOrEqual(rev);
  });
});
