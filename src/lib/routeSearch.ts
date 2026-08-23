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

function edgeLeg(e: SegmentEdge): RouteResult {
  return { nodeChain: [e.from, e.to], segmentIds: [e.id], lengthM: e.lengthM, durationMin: e.durationMin };
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

type Step = { kind: "node"; node: number } | { kind: "edge"; edge: SegmentEdge };

/**
 * Build one skeleton route through the ordered must-visit nodes while forcing every
 * required edge to be traversed (in either direction). Required edges are ordered by a
 * greedy nearest-from-start heuristic, then stitched in: route to an endpoint, take the
 * edge, continue. Returns null if any leg is unreachable under `excluded`.
 */
function buildSkeleton(
  graph: Graph,
  pairOf: Map<number, number>,
  edgeById: Map<number, SegmentEdge>,
  start: number,
  destination: number,
  mustVisit: number[],
  requiredEdges: SegmentEdge[],
  mode: RouteMode,
  excluded: Set<number>,
): RouteResult | null {
  const distTo = (from: number, to: number): number =>
    dijkstra(graph, from, to, mode, excluded)?.lengthM ?? Number.POSITIVE_INFINITY;

  const orderedRequired = [...requiredEdges].sort(
    (a, b) => distTo(start, a.from) - distTo(start, b.from),
  );

  const plan: Step[] = [];
  for (const n of mustVisit) plan.push({ kind: "node", node: n });
  for (const e of orderedRequired) plan.push({ kind: "edge", edge: e });
  plan.push({ kind: "node", node: destination });

  const legs: RouteResult[] = [];
  let current = start;
  let lastEdge: number | null = null;

  const goTo = (target: number): boolean => {
    if (target === current) return true;
    const blocked = new Set<number>();
    if (lastEdge !== null) {
      const rev = pairOf.get(lastEdge);
      if (rev !== undefined) blocked.add(rev);
    }
    // Prefer not to immediately reverse onto the join edge; retry without that block if needed.
    let leg = dijkstra(graph, current, target, mode, excluded, blocked);
    if (!leg) leg = dijkstra(graph, current, target, mode, excluded);
    if (!leg) return false;
    legs.push(leg);
    current = target;
    if (leg.segmentIds.length > 0) lastEdge = leg.segmentIds[leg.segmentIds.length - 1]!;
    return true;
  };

  const takeEdge = (e: SegmentEdge): void => {
    legs.push(edgeLeg(e));
    current = e.to;
    lastEdge = e.id;
  };

  for (const step of plan) {
    if (step.kind === "node") {
      if (!goTo(step.node)) return null;
      continue;
    }
    const e = step.edge;
    const revId = pairOf.get(e.id);
    const revEdge = revId !== undefined ? edgeById.get(revId) : undefined;
    const distForward = distTo(current, e.from);
    const distReverse = revEdge ? distTo(current, e.to) : Number.POSITIVE_INFINITY;
    if (distForward <= distReverse) {
      if (goTo(e.from)) {
        takeEdge(e);
      } else if (revEdge && goTo(e.to)) {
        takeEdge(revEdge);
      } else {
        return null;
      }
    } else {
      if (revEdge && goTo(e.to)) {
        takeEdge(revEdge);
      } else if (goTo(e.from)) {
        takeEdge(e);
      } else {
        return null;
      }
    }
  }

  return concat(legs);
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

function sampleMidNodes(
  nodeSet: Set<number>,
  exclude: Set<number>,
  cap: number,
): number[] {
  const all = [...nodeSet].filter((n) => !exclude.has(n)).sort((a, b) => a - b);
  if (all.length <= cap) return all;
  const out: number[] = [];
  const step = all.length / cap;
  for (let i = 0; i < all.length; i += step) out.push(all[Math.floor(i)]!);
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

  const isLoop = start === destination && mustVisit.length === 0 && requiredEdges.length === 0;
  const midNodes = sampleMidNodes(nodeSet, new Set([start, destination, ...mustVisit]), 180);

  if (isLoop) {
    for (const m of midNodes) {
      add(loopVia(graph, pairOf, start, m, mode, excluded));
      if (pool.length >= maxPool) break;
    }
  } else {
    add(buildSkeleton(graph, pairOf, edgeById, start, destination, mustVisit, requiredEdges, mode, excluded));
    // Length expansion: append one extra mid-node via so a too-short skeleton can grow.
    for (const m of midNodes) {
      add(
        buildSkeleton(
          graph,
          pairOf,
          edgeById,
          start,
          destination,
          [...mustVisit, m],
          requiredEdges,
          mode,
          excluded,
        ),
      );
      if (pool.length >= maxPool) break;
    }
  }

  // Yen-like alternatives: hide one physical path from an existing route and re-stitch.
  const base = pool.slice(0, Math.min(8, pool.length));
  for (const r of base) {
    if (pool.length >= maxPool) break;
    const canon = new Set<number>();
    for (const id of r.segmentIds) canon.add(Math.min(id, pairOf.get(id) ?? id));
    for (const c of canon) {
      if (pool.length >= maxPool) break;
      const excl = new Set(excluded);
      excl.add(c);
      const pr = pairOf.get(c);
      if (pr !== undefined) excl.add(pr);
      if (isLoop) {
        const midOnRoute = r.nodeChain[Math.floor(r.nodeChain.length / 2)];
        if (midOnRoute !== undefined && midOnRoute !== start) {
          add(loopVia(graph, pairOf, start, midOnRoute, mode, excl));
        }
      } else {
        add(buildSkeleton(graph, pairOf, edgeById, start, destination, mustVisit, requiredEdges, mode, excl));
      }
    }
  }

  return pool;
}
