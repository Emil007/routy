// Route-finding: ported from the legacy Python bot's DFS approach, extended with
// a dead-end exception and start/destination/waypoint support.

import { type LatLng, countSelfIntersections } from "./geo";

export interface SegmentEdge {
  id: number;
  from: number;
  to: number;
  lengthM: number;
  durationMin: number;
}

export interface Graph {
  adjacency: Map<number, SegmentEdge[]>;
}

export function buildGraph(edges: SegmentEdge[]): Graph {
  const adjacency = new Map<number, SegmentEdge[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }
  return { adjacency };
}

/** Maps a segment id to the id of its automatically generated reverse-direction counterpart. */
export function buildPairMap(edges: { id: number; reverseOf: number | null }[]): Map<number, number> {
  const pairOf = new Map<number, number>();
  for (const e of edges) {
    if (e.reverseOf !== null) {
      pairOf.set(e.id, e.reverseOf);
      pairOf.set(e.reverseOf, e.id);
    }
  }
  return pairOf;
}

export type RouteMode = "km" | "min";

export interface RouteResult {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
}

interface SearchParams {
  graph: Graph;
  pairOf: Map<number, number>;
  start: number;
  destination: number;
  mode: RouteMode;
  minValue: number;
  maxValue: number;
  maxResults: number;
  seed?: {
    usedEdges: Set<number>;
    lastEdgeId: number | null;
    nodeChain: number[];
    segmentIds: number[];
    lengthM: number;
    durationMin: number;
  };
  stepLimit?: number;
}

const DEFAULT_STEP_LIMIT = 150000;

/** Fisher-Yates shuffle — used so repeated searches explore edges in a different
 * order instead of always finding the same early candidates first. This is what
 * makes suggestions vary between calls, and also improves the odds of finding a
 * low-backtrack loop within the maxResults/stepLimit cap instead of only ever
 * sampling the same left-to-right traversal. */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function searchPaths(params: SearchParams): RouteResult[] {
  const { graph, pairOf, start, destination, mode, minValue, maxValue, maxResults } = params;
  const stepLimit = params.stepLimit ?? DEFAULT_STEP_LIMIT;

  const results: RouteResult[] = [];
  const usedEdges = params.seed ? new Set(params.seed.usedEdges) : new Set<number>();
  const nodeChain = params.seed ? [...params.seed.nodeChain] : [start];
  const segmentIds = params.seed ? [...params.seed.segmentIds] : [];
  const baseLengthM = params.seed?.lengthM ?? 0;
  const baseDurationMin = params.seed?.durationMin ?? 0;
  const startLastEdgeId = params.seed?.lastEdgeId ?? null;

  let steps = 0;

  function value(lengthM: number, durationMin: number): number {
    return mode === "km" ? lengthM : durationMin;
  }

  function dfs(curr: number, lastEdgeId: number | null, lengthM: number, durationMin: number) {
    steps++;
    if (steps > stepLimit || results.length >= maxResults) return;

    const val = value(lengthM, durationMin);
    if (curr === destination && nodeChain.length > 1 && val >= minValue && val <= maxValue) {
      results.push({
        nodeChain: [...nodeChain],
        segmentIds: [...segmentIds],
        lengthM,
        durationMin,
      });
      return;
    }
    if (val > maxValue) return;

    const edges = graph.adjacency.get(curr) ?? [];
    const availableEdges = edges.filter((e) => !usedEdges.has(e.id));
    if (availableEdges.length === 0) return;

    // No immediate reverse onto the edge just travelled, unless it is the only
    // unused option left at this node (dead end / spur trail exception).
    const nonReverseEdges =
      lastEdgeId === null ? availableEdges : availableEdges.filter((e) => pairOf.get(lastEdgeId) !== e.id);
    const candidateEdges = shuffled(nonReverseEdges.length > 0 ? nonReverseEdges : availableEdges);

    for (const edge of candidateEdges) {
      usedEdges.add(edge.id);
      nodeChain.push(edge.to);
      segmentIds.push(edge.id);
      dfs(edge.to, edge.id, lengthM + edge.lengthM, durationMin + edge.durationMin);
      segmentIds.pop();
      nodeChain.pop();
      usedEdges.delete(edge.id);
      if (results.length >= maxResults || steps > stepLimit) return;
    }
  }

  dfs(start, startLastEdgeId, baseLengthM, baseDurationMin);
  return results;
}

export function findDirectRoutes(
  graph: Graph,
  pairOf: Map<number, number>,
  start: number,
  destination: number,
  mode: RouteMode,
  minValue: number,
  maxValue: number,
  maxResults = 300,
): RouteResult[] {
  return searchPaths({ graph, pairOf, start, destination, mode, minValue, maxValue, maxResults });
}

/** Two-leg search via an intermediate waypoint: start -> waypoint -> destination. */
export function findWaypointRoutes(
  graph: Graph,
  pairOf: Map<number, number>,
  start: number,
  waypoint: number,
  destination: number,
  mode: RouteMode,
  minValue: number,
  maxValue: number,
  maxResults = 200,
): RouteResult[] {
  const leg1Candidates = searchPaths({
    graph,
    pairOf,
    start,
    destination: waypoint,
    mode,
    minValue: 0,
    maxValue,
    maxResults: 60,
  });

  const combined: RouteResult[] = [];
  for (const leg1 of leg1Candidates) {
    const leg1Value = mode === "km" ? leg1.lengthM : leg1.durationMin;
    const remainingMax = maxValue - leg1Value;
    if (remainingMax < 0) continue;
    const remainingMin = Math.max(0, minValue - leg1Value);

    const leg2 = searchPaths({
      graph,
      pairOf,
      start: waypoint,
      destination,
      mode,
      minValue: remainingMin,
      maxValue: remainingMax,
      maxResults: 8,
      seed: {
        usedEdges: new Set(leg1.segmentIds),
        lastEdgeId: leg1.segmentIds[leg1.segmentIds.length - 1] ?? null,
        nodeChain: leg1.nodeChain,
        segmentIds: leg1.segmentIds,
        lengthM: leg1.lengthM,
        durationMin: leg1.durationMin,
      },
    });

    combined.push(...leg2);
    if (combined.length >= maxResults) break;
  }

  return combined.slice(0, maxResults);
}

// --- Scoring & selection (fairness: least-used segments, daily diversity, session variety) ---

export function segmentSetKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

/**
 * Counts how many times a route walks the same physical path more than once
 * (its forward and reverse directions count as the same path) — an out-and-back
 * stretch scores high here even though it never immediately reverses onto the
 * edge it just came from. Zero means a genuine loop that never repeats a path.
 */
export function backtrackScore(segmentIds: number[], pairOf: Map<number, number>): number {
  const canonicalCounts = new Map<number, number>();
  for (const id of segmentIds) {
    const pair = pairOf.get(id);
    const canonical = pair !== undefined ? Math.min(id, pair) : id;
    canonicalCounts.set(canonical, (canonicalCounts.get(canonical) ?? 0) + 1);
  }
  let extra = 0;
  for (const count of canonicalCounts.values()) if (count > 1) extra += count - 1;
  return extra;
}

/**
 * Counts how many times the route's walked path crosses itself — two legs that
 * aren't adjacent in the chain but geometrically intersect. Straight there-and-back
 * stretches already score via `backtrackScore` (same edge walked twice); this catches
 * the geometrically-similar case of a route that loops back over ground it already
 * covered via a *different* edge, e.g. two roughly-parallel streets crossed by a third.
 * Zero means a clean loop that never crosses its own path.
 */
export function crossingScore(segmentIds: number[], geometryOf: Map<number, LatLng[]>): number {
  const points: LatLng[] = [];
  for (const id of segmentIds) {
    const geom = geometryOf.get(id);
    if (!geom || geom.length === 0) continue;
    points.push(...(points.length > 0 ? geom.slice(1) : geom));
  }
  return countSelfIntersections(points);
}

export interface ScoredRoute {
  route: RouteResult;
  key: string;
  backtrack: number;
  crossing: number;
  weightedUsage: number;
  overlap: number;
  delta: number;
  /** Count of segments in the route that have never been walked by anyone (usage count 0). */
  unexplored: number;
}

export function scoreRoutes(
  routes: RouteResult[],
  pairOf: Map<number, number>,
  usageMap: Map<number, number>,
  dailyMap: Map<number, number>,
  dailyWeight: number,
  seenUnion: Set<number>,
  targetValue: number,
  mode: RouteMode,
  geometryOf: Map<number, LatLng[]> = new Map(),
): ScoredRoute[] {
  return routes.map((route) => {
    const usageSum = route.segmentIds.reduce((s, id) => s + (usageMap.get(id) ?? 0), 0);
    const dailySum = route.segmentIds.reduce((s, id) => s + (dailyMap.get(id) ?? 0), 0) * dailyWeight;
    const segSet = new Set(route.segmentIds);
    let overlap = 0;
    if (seenUnion.size > 0 && segSet.size > 0) {
      let inter = 0;
      for (const id of segSet) if (seenUnion.has(id)) inter++;
      const unionSize = new Set([...segSet, ...seenUnion]).size;
      overlap = unionSize > 0 ? inter / unionSize : 0;
    }
    const actual = mode === "km" ? route.lengthM : route.durationMin;
    const unexplored = route.segmentIds.filter((id) => (usageMap.get(id) ?? 0) === 0).length;
    return {
      route,
      key: segmentSetKey(route.segmentIds),
      backtrack: backtrackScore(route.segmentIds, pairOf),
      crossing: crossingScore(route.segmentIds, geometryOf),
      weightedUsage: usageSum + dailySum,
      overlap,
      delta: Math.abs(actual - targetValue),
      unexplored,
    };
  });
}

/**
 * Picks the best-scoring route. In explorer mode, routes covering more
 * never-walked segments win first — the usual shape/usage/overlap/delta
 * chain still decides ties, so an explorer-mode pick is still as nice a loop
 * as possible among the most-unexplored candidates. With explorer mode off
 * this is unchanged from before.
 *
 * "Shape" (backtrack + crossing) is the top-priority tiebreaker: routes that
 * repeat a physical path (out-and-back) or cross their own path score worse
 * here, which steers selection toward genuine loops.
 */
export function pickBest(scored: ScoredRoute[], excludeKeys: Set<string>, explorerMode = false): ScoredRoute | null {
  let best: ScoredRoute | null = null;
  for (const s of scored) {
    if (excludeKeys.has(s.key)) continue;
    if (!best) {
      best = s;
      continue;
    }
    if (explorerMode && s.unexplored !== best.unexplored) {
      if (s.unexplored > best.unexplored) best = s;
      continue;
    }
    const sShape = s.backtrack + s.crossing;
    const bestShape = best.backtrack + best.crossing;
    if (
      sShape < bestShape ||
      (sShape === bestShape &&
        (s.weightedUsage < best.weightedUsage ||
          (s.weightedUsage === best.weightedUsage &&
            (s.overlap < best.overlap || (s.overlap === best.overlap && s.delta < best.delta)))))
    ) {
      best = s;
    }
  }
  return best;
}

export function toleranceRange(
  target: number,
  tolerancePercent: number,
): { minValue: number; maxValue: number } {
  const tol = target * (tolerancePercent / 100);
  return { minValue: Math.max(0, target - tol), maxValue: target + tol };
}
