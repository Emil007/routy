// Primary route-generation engine (Phase L redesign).
//
// This module replaces "shuffle a DFS until something in the length band pops out"
// as the primary finder. It builds routes from **shortest-path legs** (Dijkstra) on
// the segment graph:
//   - start → each must-visit in order → destination (loop when start === destination),
//   - excludedSegmentIds hard-dropped from the graph,
//   - requiredSegmentIds stitched in as forced hops (route to an endpoint, take the edge),
//   - length band reached by adding mid-node detours and Yen-like alternate legs,
//     producing a *pool* of alternatives that the caller then scores + ranks.
//
// The DFS in routing.ts (`searchPaths` / `findMultiWaypointRoutes`) is kept only as a
// documented last-resort fallback for the rare case this pool comes back empty.

import type { Graph, RouteMode, RouteResult, SegmentEdge } from "./routing";
import { shuffled, rng } from "./seededRandom";
import { buildTourFromPlan, optimizeCoreTourPlan } from "./coreTour";
import { extendCoreTour } from "./extendTour";

/** Binary min-heap keyed by numeric priority; payload is a node id. */
class MinHeap {
  private a: Array<[number, number]> = [];
  get size(): number {
    return this.a.length;
  }
  push(item: [number, number]): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && a[l]![0] < a[s]![0]) s = l;
        if (r < n && a[r]![0] < a[s]![0]) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i]!, a[s]!];
        i = s;
      }
    }
    return top;
  }
}

function edgeCost(edge: SegmentEdge, mode: RouteMode): number {
  return mode === "km" ? edge.lengthM : edge.durationMin;
}

/**
 * Shortest directed path from `start` to `goal` (Dijkstra; cost = length or duration).
 * `excluded` and `blocked` directed segment ids are hidden from the graph.
 * Returns null when unreachable. start === goal yields the empty (zero-length) route.
 */
export function dijkstra(
  graph: Graph,
  start: number,
  goal: number,
  mode: RouteMode,
  excluded: Set<number> = new Set(),
  blocked: Set<number> = new Set(),
): RouteResult | null {
  if (start === goal) return { nodeChain: [start], segmentIds: [], lengthM: 0, durationMin: 0 };

  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, { node: number; edge: SegmentEdge }>();
  const settled = new Set<number>();
  const heap = new MinHeap();
  heap.push([0, start]);

  while (heap.size > 0) {
    const [d, u] = heap.pop()!;
    if (settled.has(u)) continue;
    settled.add(u);
    if (u === goal) break;
    for (const e of graph.adjacency.get(u) ?? []) {
      if (excluded.has(e.id) || blocked.has(e.id)) continue;
      if (settled.has(e.to)) continue;
      const nd = d + edgeCost(e, mode);
      if (nd < (dist.get(e.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node: u, edge: e });
        heap.push([nd, e.to]);
      }
    }
  }

  if (!settled.has(goal)) return null;

  const segs: SegmentEdge[] = [];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur);
    if (!p) return null;
    segs.push(p.edge);
    cur = p.node;
  }
  segs.reverse();

  const nodeChain = [start];
  let lengthM = 0;
  let durationMin = 0;
  for (const e of segs) {
    nodeChain.push(e.to);
    lengthM += e.lengthM;
    durationMin += e.durationMin;
  }
  return { nodeChain, segmentIds: segs.map((e) => e.id), lengthM, durationMin };
}

/** Concatenate consecutive legs into one route, de-duplicating the shared join node. */
function concat(legs: RouteResult[]): RouteResult {
  const nodeChain: number[] = [];
  const segmentIds: number[] = [];
  let lengthM = 0;
  let durationMin = 0;
  for (const leg of legs) {
    if (nodeChain.length === 0) nodeChain.push(...leg.nodeChain);
    else nodeChain.push(...leg.nodeChain.slice(1));
    segmentIds.push(...leg.segmentIds);
    lengthM += leg.lengthM;
    durationMin += leg.durationMin;
  }
  return { nodeChain, segmentIds, lengthM, durationMin };
}

/** Directed ids of a route plus their reverse pairs — used to force genuine (non-retracing) loops. */
function canonicalBlock(segmentIds: number[], pairOf: Map<number, number>): Set<number> {
  const s = new Set<number>();
  for (const id of segmentIds) {
    s.add(id);
    const p = pairOf.get(id);
    if (p !== undefined) s.add(p);
  }
  return s;
}

/** Build core tour via TSP-ordered plan, then optional length extension. */
function buildCoreTourRoute(
  graph: Graph,
  pairOf: Map<number, number>,
  edgeById: Map<number, SegmentEdge>,
  start: number,
  destination: number,
  mustVisit: number[],
  requiredEdges: SegmentEdge[],
  mode: RouteMode,
  excluded: Set<number>,
  minValue: number,
  maxValue: number,
  preserveMustVisitOrder = false,
): RouteResult | null {
  const plan = optimizeCoreTourPlan({
    graph,
    pairOf,
    edgeById,
    start,
    destination,
    mustVisit,
    requiredEdges,
    mode,
    excluded,
    preserveOrder: preserveMustVisitOrder,
  });
  const withDest =
    destination === start || plan.some((s) => s.kind === "node" && s.node === destination)
      ? plan
      : [...plan, { kind: "node" as const, node: destination }];
  const core = buildTourFromPlan(graph, pairOf, edgeById, start, withDest, mode, excluded);
  if (!core) return null;
  // Plan ordering includes leg cost back to destination, but buildTourFromPlan only
  // executes the plan — for loops (start === destination) withDest skips a final
  // home node, so stitch the return leg when the tour ends elsewhere.
  let stitched = core;
  const lastNode = core.nodeChain[core.nodeChain.length - 1]!;
  if (lastNode !== destination) {
    const returnLeg = dijkstra(graph, lastNode, destination, mode, excluded);
    if (!returnLeg || returnLeg.segmentIds.length === 0) return null;
    stitched = concat([core, returnLeg]);
  }
  const extended = extendCoreTour(stitched, graph, pairOf, start, destination, mode, excluded, minValue, maxValue);
  return {
    ...extended.route,
    coreLengthM: extended.coreLengthM,
    extensionLengthM: extended.extensionLengthM,
  };
}

/** Genuine loop start → m → start where the return leg avoids the outbound physical paths. */
function loopVia(
  graph: Graph,
  pairOf: Map<number, number>,
  start: number,
  m: number,
  mode: RouteMode,
  excluded: Set<number>,
): RouteResult | null {
  const leg1 = dijkstra(graph, start, m, mode, excluded);
  if (!leg1 || leg1.segmentIds.length === 0) return null;
  const block = canonicalBlock(leg1.segmentIds, pairOf);
  const leg2 = dijkstra(graph, m, start, mode, excluded, block);
  if (leg2) return concat([leg1, leg2]);
  // No disjoint return path: fall back to an out-and-back on the same connector.
  const back = dijkstra(graph, m, start, mode, excluded);
  return back ? concat([leg1, back]) : null;
}

/**
 * Sample mid nodes for loop/detour candidates.
 *
 * The order of the returned array drives the order candidates are stitched in
 * `generateRoutePool`. Deterministic sorted order meant a fresh page reload
 * always explored the same (sorted) subset and produced the same route every
 * generate — there was no randomness to differentiate consecutive builds. We
 * now shuffle the sample so each generate explores a different slice of the
 * graph, while keeping enough maxResults headroom for the caller's cap.
 */
function sampleMidNodes(
  nodeSet: Set<number>,
  exclude: Set<number>,
  cap: number,
): number[] {
  const all = [...nodeSet].filter((n) => !exclude.has(n)).sort((a, b) => a - b);
  if (all.length <= cap) return shuffledList(all);
  const out: number[] = [];
  const step = all.length / cap;
  for (let i = 0; i < all.length; i += step) out.push(all[Math.floor(i)]!);
  return shuffledList(out);
}

/** Fisher–Yates shuffle via the seeded PRNG (pure, no global mutation). */
function shuffledList<T>(items: T[]): T[] {
  return shuffled(items);
}

/** All distinct permutations of `arr` (only used for small N — see buildOrderings). */
function allPermutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [[...arr]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of allPermutations(rest)) out.push([arr[i]!, ...p]);
  }
  return out;
}

/**
 * Must-visit orderings to explore when building the pool.
 *
 * The caller usually passes ONE optimized TSP order. Building every candidate
 * from that single skeleton collapses into very few distinct segment sets once
 * the binding shape rules hard-filter (Emanuel: a 3-point request must actually
 * vary, and the shape rules are NOT what kills the diversity). Exploring the
 * permutation space lets each ordering produce its own core + extension:
 *  - ≤3 stops: all N! orders (cheap, and that's the common hand-tapped case);
 *  - more: the optimized order first, then bounded random shuffles;
 *  - preserveOrder (user explicitly locked tap order): only that order.
 */
function buildOrderings(must: number[], preserve: boolean): number[][] {
  if (must.length === 0) return [[]];
  if (preserve) return [must];
  if (must.length <= 3) return shuffledList(allPermutations(must));
  const out: number[][] = [must];
  const extras = Math.min(5, Math.max(1, 18 - must.length));
  for (let i = 0; i < extras; i++) out.push(shuffledList(must));
  return out;
}

export interface PoolParams {
  graph: Graph;
  pairOf: Map<number, number>;
  start: number;
  destination: number;
  mustVisitNodeIds: number[];
  requiredSegmentIds: number[];
  excludedSegmentIds: Set<number>;
  mode: RouteMode;
  minValue: number;
  maxValue: number;
  maxResults?: number;
  preserveMustVisitOrder?: boolean;
}

/**
 * Build a pool of candidate routes with shortest-path legs plus mid-node detours and
 * Yen-like alternate legs. The caller filters by required segments / length band and
 * ranks with scoreRoutes / pickBest. Returns [] when nothing can be stitched (the DFS
 * fallback then takes over).
 */
export function generateRoutePool(p: PoolParams): RouteResult[] {
  const { graph, pairOf, start, destination, mode } = p;
  const excluded = p.excludedSegmentIds;
  const mustVisit = p.mustVisitNodeIds.filter((id, i, arr) => arr.indexOf(id) === i);
  const maxPool = p.maxResults ?? 120;

  const edgeById = new Map<number, SegmentEdge>();
  const nodeSet = new Set<number>();
  for (const [from, edges] of graph.adjacency) {
    nodeSet.add(from);
    for (const e of edges) {
      edgeById.set(e.id, e);
      nodeSet.add(e.to);
    }
  }

  const requiredEdges: SegmentEdge[] = [];
  for (const id of p.requiredSegmentIds) {
    const e = edgeById.get(id);
    if (e) requiredEdges.push(e);
    else {
      const revId = pairOf.get(id);
      const rev = revId !== undefined ? edgeById.get(revId) : undefined;
      if (rev) requiredEdges.push(rev);
    }
  }

  const pool: RouteResult[] = [];
  const seen = new Set<string>();
  const add = (r: RouteResult | null): void => {
    if (!r || r.segmentIds.length === 0) return;
    const key = [...r.segmentIds].sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(r);
  };

  const hasConstraints = mustVisit.length > 0 || requiredEdges.length > 0;
  const isLoop = start === destination && !hasConstraints;
  const preserveOrder = p.preserveMustVisitOrder === true;
  const orderings = buildOrderings(mustVisit, preserveOrder);
  // When we explore several orderings, each must be built with its order LOCKED
  // (preserveOrder=true) — otherwise buildCoreTourRoute re-optimizes internally
  // and every ordering collapses back onto the single optimal skeleton, killing
  // the diversity Emanuel needs for multi-point routes (probe8: 6 orders → 5
  // distinct routes once order is preserved). The orderings are permutations of
  // the optimizer's output, so they are all near-optimal starting points.
  const lockOrder = preserveOrder || orderings.length > 1;
  // Distribute the detour budget across orderings so total work stays ~constant
  // and the performance ceiling (cursor/codex review #8) isn't multiplied by N!.
  const perOrderMid = Math.max(1, Math.ceil(180 / orderings.length));
  const midNodes = sampleMidNodes(nodeSet, new Set([start, destination, ...mustVisit]), perOrderMid);

  // Which ordering built each candidate — the Yen pass later re-stitches a
  // blocked variant with the SAME skeleton ordering, so the alternative stays
  // genuinely different instead of snapping back to the optimized core.
  const orderOf = new Map<RouteResult, number[]>();

  const buildForOrder = (order: number[]): void => {
    add(
      buildCoreTourRoute(
        graph,
        pairOf,
        edgeById,
        start,
        destination,
        order,
        requiredEdges,
        mode,
        excluded,
        p.minValue,
        p.maxValue,
        lockOrder,
      ),
    );
    for (const m of midNodes) {
      const candidate = buildCoreTourRoute(
        graph,
        pairOf,
        edgeById,
        start,
        destination,
        [...order, m],
        requiredEdges,
        mode,
        excluded,
        p.minValue,
        p.maxValue,
        lockOrder,
      );
      if (candidate) {
        orderOf.set(candidate, order);
        add(candidate);
      }
      if (pool.length >= maxPool) break;
    }
  };

  if (isLoop) {
    for (const m of midNodes) {
      add(loopVia(graph, pairOf, start, m, mode, excluded));
      if (pool.length >= maxPool) break;
    }
  } else {
    for (const order of orderings) {
      const before = pool.length;
      buildForOrder(order);
      // Tag any candidate added by this ordering (the core + its detours).
      for (let i = before; i < pool.length; i++) {
        if (!orderOf.has(pool[i]!)) orderOf.set(pool[i]!, order);
      }
      if (pool.length >= maxPool) break;
    }
  }

  // Yen-like alternatives: hide one physical path from an existing route and re-stitch.
  // Process the base set in shuffled order and pick a varied selection of blocked
  // paths (not just the first) so successive generates re-explore a different
  // neighbourhood instead of always deriving from the same routes.
  const base = shuffledList(pool.slice(0, Math.min(12, pool.length)));
  for (const r of base) {
    if (pool.length >= maxPool) break;
    const canon = [...new Set(r.segmentIds.map((id) => Math.min(id, pairOf.get(id) ?? id)))];
    const blocked = shuffledList(canon).slice(0, Math.min(6, canon.length));
    const order = orderOf.get(r) ?? mustVisit;
    for (const c of blocked) {
      if (pool.length >= maxPool) break;
      const excl = new Set(excluded);
      excl.add(c);
      const pr = pairOf.get(c);
      if (pr !== undefined) excl.add(pr);
      if (isLoop) {
        // Pick a mid node NOT on the current route so the reshuffle builds a
        // genuinely different segment set (Yen-like) instead of re-walking the
        // same neighbourhood back home. Choose from all nodes that are not on the
        // candidate's chain — that's what forces a new physical path into the pool.
        const onRoute = new Set(r.nodeChain);
        const offRoute = [...nodeSet].filter((n) => !onRoute.has(n) && n !== start);
        const mid = offRoute[Math.floor(rng() * offRoute.length)];
        if (mid !== undefined) {
          add(loopVia(graph, pairOf, start, mid, mode, excl));
        }
      } else {
        add(
          buildCoreTourRoute(
            graph,
            pairOf,
            edgeById,
            start,
            destination,
            order,
            requiredEdges,
            mode,
            excl,
            p.minValue,
            p.maxValue,
            lockOrder,
          ),
        );
      }
    }
  }

  return shuffledList(pool);
}
