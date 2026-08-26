// Route-finding: ported from the legacy Python bot's DFS approach, extended with
// a dead-end exception and start/destination/waypoint support.

import { type LatLng, countSelfIntersections } from "./geo";
import { computeRoutePointPreview, canonicalSegmentId } from "./points";
import { listSegments } from "./segments";
import { generateRoutePool } from "./routeSearch";
import { optimizeMustVisitOrder } from "./mustVisitOrder";

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
  /** Hard-drop these directed segment ids from the search graph. */
  excludedSegmentIds?: Set<number>;
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
  const excluded = params.excludedSegmentIds ?? new Set<number>();

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
    const availableEdges = edges.filter((e) => !usedEdges.has(e.id) && !excluded.has(e.id));
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
  excludedSegmentIds?: Set<number>,
): RouteResult[] {
  return searchPaths({
    graph,
    pairOf,
    start,
    destination,
    mode,
    minValue,
    maxValue,
    maxResults,
    excludedSegmentIds,
  });
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
  excludedSegmentIds?: Set<number>,
): RouteResult[] {
  return findMultiWaypointRoutes(
    graph,
    pairOf,
    start,
    [waypoint],
    destination,
    mode,
    minValue,
    maxValue,
    maxResults,
    excludedSegmentIds,
  );
}

/**
 * N-leg chained search: start → mustVisit[0] → … → mustVisit[n-1] → destination.
 * Caps scale with N so later legs are not starved.
 */
export function findMultiWaypointRoutes(
  graph: Graph,
  pairOf: Map<number, number>,
  start: number,
  mustVisitNodeIds: number[],
  destination: number,
  mode: RouteMode,
  minValue: number,
  maxValue: number,
  maxResults = 200,
  excludedSegmentIds?: Set<number>,
): RouteResult[] {
  const waypoints = mustVisitNodeIds.filter(
    (id, i, arr) => id !== start && id !== destination && arr.indexOf(id) === i,
  );
  if (waypoints.length === 0) {
    return findDirectRoutes(graph, pairOf, start, destination, mode, minValue, maxValue, maxResults, excludedSegmentIds);
  }

  const stops = [start, ...waypoints, destination];
  const legCount = stops.length - 1;
  // Scale per-leg budgets so the last legs still get samples.
  const firstLegMax = Math.max(20, Math.floor(80 / Math.sqrt(legCount)));
  const laterLegMax = Math.max(4, Math.floor(12 / Math.sqrt(legCount)));

  type Partial = RouteResult;
  let frontier: Partial[] = searchPaths({
    graph,
    pairOf,
    start: stops[0]!,
    destination: stops[1]!,
    mode,
    minValue: 0,
    maxValue,
    maxResults: firstLegMax,
    excludedSegmentIds,
  });

  for (let leg = 1; leg < legCount; leg++) {
    const nextStop = stops[leg + 1]!;
    const isLast = leg === legCount - 1;
    const next: Partial[] = [];
    for (const partial of frontier) {
      const partialValue = mode === "km" ? partial.lengthM : partial.durationMin;
      // Seed carries cumulative length into DFS, so min/max must stay the
      // total band — not "remaining" — or later legs never match.
      if (partialValue > maxValue) continue;
      const extensions = searchPaths({
        graph,
        pairOf,
        start: stops[leg]!,
        destination: nextStop,
        mode,
        minValue: isLast ? minValue : 0,
        maxValue,
        maxResults: laterLegMax,
        excludedSegmentIds,
        seed: {
          usedEdges: new Set(partial.segmentIds),
          lastEdgeId: partial.segmentIds[partial.segmentIds.length - 1] ?? null,
          nodeChain: partial.nodeChain,
          segmentIds: partial.segmentIds,
          lengthM: partial.lengthM,
          durationMin: partial.durationMin,
        },
      });
      next.push(...extensions);
      if (next.length >= maxResults * 2) break;
    }
    frontier = next;
    if (frontier.length === 0) return [];
  }

  return frontier.slice(0, maxResults);
}

/** Keep routes that include every required directed (or reverse-pair) segment. */
export function filterRequiredSegments(
  routes: RouteResult[],
  requiredSegmentIds: number[],
  pairOf: Map<number, number>,
): RouteResult[] {
  if (requiredSegmentIds.length === 0) return routes;
  return routes.filter((route) => {
    const set = new Set(route.segmentIds);
    return requiredSegmentIds.every((id) => {
      const pair = pairOf.get(id);
      return set.has(id) || (pair !== undefined && set.has(pair));
    });
  });
}

function closestFeasible(
  feasible: RouteResult[],
  mode: RouteMode,
  minValue: number,
  maxValue: number,
): RouteResult[] {
  const target = (minValue + maxValue) / 2;
  const sorted = [...feasible].sort((a, b) => {
    const aVal = mode === "km" ? a.lengthM : a.durationMin;
    const bVal = mode === "km" ? b.lengthM : b.durationMin;
    const aDelta = Math.abs(aVal - target);
    const bDelta = Math.abs(bVal - target);
    if (aDelta !== bDelta) return aDelta - bDelta;
    return aVal - bVal;
  });
  return sorted.slice(0, Math.min(40, sorted.length));
}

/**
 * Search with optional must-visit nodes / required / excluded segments.
 *
 * Primary engine (Phase L): a Dijkstra shortest-path pool from `routeSearch.ts` —
 * shortest legs start → each must-visit → destination, required edges stitched in as
 * forced hops, and mid-node detours / Yen-like alternate legs to reach the length band.
 * When the band is empty we return the closest feasible route with `lengthRelaxed: true`
 * (never fail on the band alone when a constraint-satisfying path exists).
 *
 * The legacy shuffled DFS (`findMultiWaypointRoutes`) is only a last-resort fallback for
 * the rare case the shortest-path pool comes back empty under these constraints.
 */
export function searchRoutesWithConstraints(opts: {
  graph: Graph;
  pairOf: Map<number, number>;
  start: number;
  destination: number;
  mustVisitNodeIds?: number[];
  requiredSegmentIds?: number[];
  excludedSegmentIds?: Set<number>;
  mode: RouteMode;
  minValue: number;
  maxValue: number;
  maxResults?: number;
  /** Keep tap order for must-visits (default: optimize via graph TSP). */
  preserveMustVisitOrder?: boolean;
}): { routes: RouteResult[]; lengthRelaxed: boolean; mustVisitOrder: number[] } {
  const {
    graph,
    pairOf,
    start,
    destination,
    mode,
    minValue,
    maxValue,
    maxResults = 300,
  } = opts;
  const excluded = opts.excludedSegmentIds ?? new Set<number>();
  const mustVisit = optimizeMustVisitOrder({
    graph,
    start,
    destination,
    mustVisitNodeIds: opts.mustVisitNodeIds ?? [],
    mode,
    excludedSegmentIds: excluded,
    preserveOrder: opts.preserveMustVisitOrder === true,
  });
  const required = opts.requiredSegmentIds ?? [];

  const inBand = (r: RouteResult): boolean => {
    const v = mode === "km" ? r.lengthM : r.durationMin;
    return v >= minValue && v <= maxValue;
  };

  // --- Primary engine: shortest-path leg pool ---
  const pool = generateRoutePool({
    graph,
    pairOf,
    start,
    destination,
    mustVisitNodeIds: mustVisit,
    requiredSegmentIds: required,
    excludedSegmentIds: excluded,
    mode,
    minValue,
    maxValue,
    maxResults,
  });
  const feasiblePool = filterRequiredSegments(pool, required, pairOf);
  const bandPool = feasiblePool.filter(inBand);
  if (bandPool.length > 0) {
    return { routes: bandPool.slice(0, maxResults), lengthRelaxed: false, mustVisitOrder: mustVisit };
  }
  if (feasiblePool.length > 0) {
    return {
      routes: closestFeasible(feasiblePool, mode, minValue, maxValue),
      lengthRelaxed: true,
      mustVisitOrder: mustVisit,
    };
  }

  // --- Last-resort fallback: legacy shuffled DFS (documented in L4) ---
  let routes = findMultiWaypointRoutes(
    graph,
    pairOf,
    start,
    mustVisit,
    destination,
    mode,
    minValue,
    maxValue,
    maxResults,
    excluded,
  );
  routes = filterRequiredSegments(routes, required, pairOf);
  if (routes.length > 0) return { routes, lengthRelaxed: false, mustVisitOrder: mustVisit };

  const open = findMultiWaypointRoutes(
    graph,
    pairOf,
    start,
    mustVisit,
    destination,
    mode,
    0,
    Number.POSITIVE_INFINITY,
    maxResults,
    excluded,
  );
  const feasible = filterRequiredSegments(open, required, pairOf);
  if (feasible.length === 0) return { routes: [], lengthRelaxed: false, mustVisitOrder: mustVisit };
  return {
    routes: closestFeasible(feasible, mode, minValue, maxValue),
    lengthRelaxed: true,
    mustVisitOrder: mustVisit,
  };
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
  /** Soft penalty for user-avoided segments on this route (higher = worse). */
  avoidPenalty: number;
  /** Soft penalty for segments with active condition reports (higher = worse). */
  conditionPenalty: number;
  /** Count of segments on the route not walked by this user in staleDays (surprise mode). */
  staleCount: number;
  /** Expected point value for gamification tie-break. */
  pointPreview: number;
  /** Distinct home-access physical connectors used (generation only; prefer ≤1 — L6). */
  homeConnectors: number;
}

/** Per avoided segment on a route — soft bias, not a hard ban. */
export const AVOID_PENALTY_WEIGHT = 25;
/** Per active condition report on a segment — stronger bias than avoid-list. */
export const CONDITION_PENALTY_WEIGHT = 75;

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
  avoidSegmentIds: Set<number> = new Set(),
  conditionCounts: Map<number, number> = new Map(),
  staleSegmentIds: Set<number> = new Set(),
  goldenMap: Map<number, number> = new Map(),
  /** Home-access connectors: still on the route, ignored for scoring / point preview. */
  ignoreSegmentIds: Set<number> = new Set(),
): ScoredRoute[] {
  const canonicalOf = new Map(listSegments().map((s) => [s.id, canonicalSegmentId(s)]));
  return routes.map((route) => {
    const scoredIds = route.segmentIds.filter((id) => !ignoreSegmentIds.has(id));
    const usageSum = scoredIds.reduce((s, id) => s + (usageMap.get(id) ?? 0), 0);
    const dailySum = scoredIds.reduce((s, id) => s + (dailyMap.get(id) ?? 0), 0) * dailyWeight;
    const segSet = new Set(scoredIds);
    let overlap = 0;
    if (seenUnion.size > 0 && segSet.size > 0) {
      let inter = 0;
      for (const id of segSet) if (seenUnion.has(id)) inter++;
      const unionSize = new Set([...segSet, ...seenUnion]).size;
      overlap = unionSize > 0 ? inter / unionSize : 0;
    }
    const actual = mode === "km" ? route.lengthM : route.durationMin;
    const unexplored = scoredIds.filter((id) => (usageMap.get(id) ?? 0) === 0).length;
    const avoidPenalty = scoredIds.reduce(
      (s, id) => s + (avoidSegmentIds.has(id) ? AVOID_PENALTY_WEIGHT : 0),
      0,
    );
    const conditionPenalty = scoredIds.reduce(
      (s, id) => s + (conditionCounts.get(id) ?? 0) * CONDITION_PENALTY_WEIGHT,
      0,
    );
    const staleCount = (() => {
      const seen = new Set<number>();
      for (const id of scoredIds) {
        if (!staleSegmentIds.has(id)) continue;
        const pair = pairOf.get(id);
        seen.add(pair !== undefined ? Math.min(id, pair) : id);
      }
      return seen.size;
    })();
    const preview = computeRoutePointPreview(
      route.segmentIds,
      route.lengthM,
      usageMap,
      goldenMap,
      canonicalOf,
      ignoreSegmentIds,
    );
    // Distinct physical home connectors on the route (L6): prefer routes that use ≤1,
    // i.e. leave and return on the same connector rather than out one / back another.
    const homeCanons = new Set<number>();
    for (const id of route.segmentIds) {
      if (!ignoreSegmentIds.has(id)) continue;
      const pair = pairOf.get(id);
      homeCanons.add(pair !== undefined ? Math.min(id, pair) : id);
    }
    return {
      route,
      key: segmentSetKey(route.segmentIds),
      backtrack: backtrackScore(scoredIds, pairOf),
      crossing: crossingScore(route.segmentIds, geometryOf),
      weightedUsage: usageSum + dailySum,
      overlap,
      delta: Math.abs(actual - targetValue),
      unexplored,
      avoidPenalty,
      conditionPenalty,
      staleCount,
      pointPreview: preview.total,
      homeConnectors: homeCanons.size,
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
export function pickBest(
  scored: ScoredRoute[],
  excludeKeys: Set<string>,
  explorerMode = false,
  surpriseMode = false,
): ScoredRoute | null {
  let best: ScoredRoute | null = null;
  for (const s of scored) {
    if (excludeKeys.has(s.key)) continue;
    if (!best) {
      best = s;
      continue;
    }
    if (surpriseMode && s.staleCount !== best.staleCount) {
      if (s.staleCount > best.staleCount) best = s;
      continue;
    }
    if (explorerMode && s.unexplored !== best.unexplored) {
      if (s.unexplored > best.unexplored) best = s;
      continue;
    }
    const sShape = s.backtrack + s.crossing;
    const bestShape = best.backtrack + best.crossing;
    // Generation-only bias: fewer distinct home connectors wins (L6). Defaults to 0 for
    // callers that don't pass home-access ids, so it's a no-op outside generation.
    const sHome = s.homeConnectors ?? 0;
    const bestHome = best.homeConnectors ?? 0;
    const deltaTol = Math.max(best.delta, s.delta) * 0.15 + 50;
    const withinDelta = Math.abs(s.delta - best.delta) <= deltaTol;
    if (
      withinDelta &&
      s.avoidPenalty === best.avoidPenalty &&
      s.conditionPenalty === best.conditionPenalty &&
      sShape === bestShape &&
      sHome === bestHome &&
      s.pointPreview > best.pointPreview
    ) {
      best = s;
      continue;
    }
    if (
      sShape < bestShape ||
      (sShape === bestShape &&
        (sHome < bestHome ||
          (sHome === bestHome &&
            (s.avoidPenalty < best.avoidPenalty ||
              (s.avoidPenalty === best.avoidPenalty &&
                (s.conditionPenalty < best.conditionPenalty ||
                  (s.conditionPenalty === best.conditionPenalty &&
                    (s.weightedUsage < best.weightedUsage ||
                      (s.weightedUsage === best.weightedUsage &&
                        (s.overlap < best.overlap || (s.overlap === best.overlap && s.delta < best.delta)))))))))))
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
