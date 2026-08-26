/**
 * Graph TSP-style ordering for must-visit waypoints (0.44).
 * Cost = Dijkstra on the segment graph (length or duration) — never crow-flies.
 * Inspired by Kōji’s stop-ordering mindset; implemented natively (no OR-Tools / LKH).
 */
import type { Graph, RouteMode } from "./routing";
import { dijkstra } from "./routeSearch";

const EXACT_MAX = 8;

function pairKey(a: number, b: number): string {
  return `${a}>${b}`;
}

/** All-pairs shortest-path costs among `nodes` (directed). Missing = unreachable. */
export function pairwiseDijkstraCosts(
  graph: Graph,
  nodes: number[],
  mode: RouteMode,
  excluded: Set<number> = new Set(),
): Map<string, number> {
  const unique = [...new Set(nodes)];
  const costs = new Map<string, number>();
  for (const from of unique) {
    for (const to of unique) {
      if (from === to) {
        costs.set(pairKey(from, to), 0);
        continue;
      }
      const route = dijkstra(graph, from, to, mode, excluded);
      if (route) costs.set(pairKey(from, to), mode === "km" ? route.lengthM : route.durationMin);
    }
  }
  return costs;
}

/** Tour cost start → order[0] → … → order[n-1] → end. Infinity if any leg missing. */
export function tourCost(
  order: number[],
  start: number,
  end: number,
  costs: Map<string, number>,
): number {
  let total = 0;
  let prev = start;
  for (const next of order) {
    const c = costs.get(pairKey(prev, next));
    if (c === undefined) return Number.POSITIVE_INFINITY;
    total += c;
    prev = next;
  }
  const last = costs.get(pairKey(prev, end));
  if (last === undefined) return Number.POSITIVE_INFINITY;
  return total + last;
}

function* permutations(arr: number[]): Generator<number[]> {
  if (arr.length <= 1) {
    yield [...arr];
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i]!, ...p];
  }
}

/** Exact best order among must-visits (small N). */
export function exactMustVisitOrder(
  mustVisit: number[],
  start: number,
  end: number,
  costs: Map<string, number>,
): number[] {
  if (mustVisit.length <= 1) return [...mustVisit];
  let best = [...mustVisit];
  let bestCost = tourCost(best, start, end, costs);
  for (const p of permutations(mustVisit)) {
    const c = tourCost(p, start, end, costs);
    if (c < bestCost) {
      bestCost = c;
      best = p;
    }
  }
  return best;
}

/** Nearest-neighbor from `start` through all must-visits. */
export function greedyMustVisitOrder(
  mustVisit: number[],
  start: number,
  end: number,
  costs: Map<string, number>,
): number[] {
  if (mustVisit.length <= 1) return [...mustVisit];
  const remaining = new Set(mustVisit);
  const order: number[] = [];
  let cur = start;
  while (remaining.size > 0) {
    let best: number | null = null;
    let bestC = Number.POSITIVE_INFINITY;
    for (const n of remaining) {
      const c = costs.get(pairKey(cur, n)) ?? Number.POSITIVE_INFINITY;
      if (c < bestC) {
        bestC = c;
        best = n;
      }
    }
    if (best == null) break;
    order.push(best);
    remaining.delete(best);
    cur = best;
  }
  // Append any unreachable leftovers in original relative order
  for (const n of mustVisit) if (remaining.has(n)) order.push(n);
  void end;
  return order;
}

/** 2-opt improvement on the middle of start → order → end. */
export function twoOptMustVisitOrder(
  order: number[],
  start: number,
  end: number,
  costs: Map<string, number>,
  maxPasses = 40,
): number[] {
  if (order.length < 2) return [...order];
  let best = [...order];
  let bestCost = tourCost(best, start, end, costs);
  let improved = true;
  let passes = 0;
  while (improved && passes++ < maxPasses) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const next = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = tourCost(next, start, end, costs);
        if (c + 1e-9 < bestCost) {
          best = next;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

export interface OptimizeMustVisitOpts {
  graph: Graph;
  start: number;
  destination: number;
  mustVisitNodeIds: number[];
  mode: RouteMode;
  excludedSegmentIds?: Set<number>;
  /** When true, leave tap order unchanged. Default: optimize. */
  preserveOrder?: boolean;
}

/**
 * Returns an optimized visit order for must-visits (start/destination fixed ends).
 * ≤8 stops: exact permutation; larger: greedy + 2-opt.
 */
export function optimizeMustVisitOrder(opts: OptimizeMustVisitOpts): number[] {
  const must = opts.mustVisitNodeIds.filter((id, i, arr) => arr.indexOf(id) === i);
  if (must.length < 2 || opts.preserveOrder) return must;

  const excluded = opts.excludedSegmentIds ?? new Set();
  const nodes = [opts.start, opts.destination, ...must];
  const costs = pairwiseDijkstraCosts(opts.graph, nodes, opts.mode, excluded);

  if (must.length <= EXACT_MAX) {
    return exactMustVisitOrder(must, opts.start, opts.destination, costs);
  }
  const greedy = greedyMustVisitOrder(must, opts.start, opts.destination, costs);
  return twoOptMustVisitOrder(greedy, opts.start, opts.destination, costs);
}
