/**
 * Core tour planning (0.46): TSP-style ordering of must-visit nodes and required
 * segments on the segment graph. Phase 1 of two-phase generate — no golden/usage bias.
 */
import type { Graph, RouteMode, RouteResult, SegmentEdge } from "./routing";
import { dijkstra } from "./routeSearch";
import { pairwiseDijkstraCosts, twoOptMustVisitOrder } from "./mustVisitOrder";

function pairKey(a: number, b: number): string {
  return `${a}>${b}`;
}

export type TourStep = { kind: "node"; node: number } | { kind: "edge"; edge: SegmentEdge; reverse: boolean };

type Task =
  | { kind: "node"; node: number }
  | { kind: "edge"; edge: SegmentEdge; reverse: boolean };

const EXACT_MAX = 8;

function taskEntry(task: Task): number {
  return task.kind === "node" ? task.node : task.reverse ? task.edge.to : task.edge.from;
}

function taskExit(task: Task): number {
  return task.kind === "node" ? task.node : task.reverse ? task.edge.from : task.edge.to;
}

function taskInternalCost(task: Task, mode: RouteMode): number {
  if (task.kind === "node") return 0;
  return mode === "km" ? task.edge.lengthM : task.edge.durationMin;
}

function legCost(
  from: number,
  to: number,
  costs: Map<string, number>,
): number {
  return costs.get(pairKey(from, to)) ?? Number.POSITIVE_INFINITY;
}

/** Tour cost for an ordered task list including internal edge lengths. */
export function coreTourCost(
  tasks: Task[],
  start: number,
  end: number,
  costs: Map<string, number>,
  mode: RouteMode,
): number {
  let total = 0;
  let cur = start;
  for (const task of tasks) {
    const entry = taskEntry(task);
    const c = legCost(cur, entry, costs);
    if (!Number.isFinite(c)) return Number.POSITIVE_INFINITY;
    total += c + taskInternalCost(task, mode);
    cur = taskExit(task);
  }
  const last = legCost(cur, end, costs);
  if (!Number.isFinite(last)) return Number.POSITIVE_INFINITY;
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

function edgeOrientations(edgeCount: number): boolean[][] {
  const out: boolean[][] = [];
  const n = 1 << edgeCount;
  for (let mask = 0; mask < n; mask++) {
    const ori: boolean[] = [];
    for (let i = 0; i < edgeCount; i++) ori.push((mask & (1 << i)) !== 0);
    out.push(ori);
  }
  return out;
}

function tasksFromOrder(items: Task[], order: number[]): Task[] {
  return order.map((i) => items[i]!);
}

function twoOptTasks(
  tasks: Task[],
  start: number,
  end: number,
  costs: Map<string, number>,
  mode: RouteMode,
  maxPasses = 40,
): Task[] {
  if (tasks.length < 2) return [...tasks];
  let best = [...tasks];
  let bestCost = coreTourCost(best, start, end, costs, mode);
  let improved = true;
  let passes = 0;
  while (improved && passes++ < maxPasses) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const next = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = coreTourCost(next, start, end, costs, mode);
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

export interface OptimizeCoreTourOpts {
  graph: Graph;
  pairOf: Map<number, number>;
  edgeById: Map<number, SegmentEdge>;
  start: number;
  destination: number;
  mustVisit: number[];
  requiredEdges: SegmentEdge[];
  mode: RouteMode;
  excluded: Set<number>;
  preserveOrder?: boolean;
}

/**
 * Returns an ordered plan of must-visits and required edges (interleaved) minimizing
 * graph leg cost. Required edges may be taken in either direction.
 */
export function optimizeCoreTourPlan(opts: OptimizeCoreTourOpts): TourStep[] {
  const must = opts.mustVisit.filter((id, i, arr) => arr.indexOf(id) === i);
  const edgeItems = opts.requiredEdges.map((edge) => ({ kind: "edge" as const, edge, reverse: false }));
  const nodeItems = must.map((node) => ({ kind: "node" as const, node }));
  const items: Task[] = [...nodeItems, ...edgeItems];

  if (items.length === 0) {
    return opts.destination === opts.start ? [] : [{ kind: "node", node: opts.destination }];
  }

  if (opts.preserveOrder) {
    return items.map((t) =>
      t.kind === "node" ? { kind: "node" as const, node: t.node } : { kind: "edge" as const, edge: t.edge, reverse: false },
    );
  }

  const nodes = new Set<number>([opts.start, opts.destination]);
  for (const t of items) {
    if (t.kind === "node") nodes.add(t.node);
    else {
      nodes.add(t.edge.from);
      nodes.add(t.edge.to);
    }
  }
  const costs = pairwiseDijkstraCosts(opts.graph, [...nodes], opts.mode, opts.excluded);

  const edgeIndices = items.map((t, i) => (t.kind === "edge" ? i : -1)).filter((i) => i >= 0);
  const orientations =
    edgeIndices.length <= 6 ? edgeOrientations(edgeIndices.length) : [[...edgeIndices.map(() => false)]];

  let bestTasks: Task[] = items;
  let bestCost = Number.POSITIVE_INFINITY;

  const tryTasks = (ordered: Task[]): void => {
    const c = coreTourCost(ordered, opts.start, opts.destination, costs, opts.mode);
    if (c < bestCost) {
      bestCost = c;
      bestTasks = ordered;
    }
  };

  if (items.length <= EXACT_MAX) {
    const idx = items.map((_, i) => i);
    for (const perm of permutations(idx)) {
      for (const ori of orientations) {
        const base = tasksFromOrder(items, perm);
        let o = 0;
        const withOri = base.map((t) => {
          if (t.kind !== "edge") return t;
          const rev = ori[o++] ?? false;
          return { kind: "edge" as const, edge: t.edge, reverse: rev };
        });
        tryTasks(withOri);
      }
    }
  } else {
    // Large: optimize nodes with mustVisitOrder, append required edges in TSP among themselves
    const nodeOnly = must;
    const nodeOrder =
      nodeOnly.length >= 2
        ? twoOptMustVisitOrder(
            nodeOnly.length <= EXACT_MAX
              ? nodeOnly
              : twoOptMustVisitOrder(nodeOnly, opts.start, opts.destination, costs),
            opts.start,
            opts.destination,
            costs,
          )
        : nodeOnly;
    const nodeTasks: Task[] = nodeOnly.length > 0 ? nodeOrder.map((n) => ({ kind: "node" as const, node: n })) : [];
    const reqOnly: Task[] = opts.requiredEdges.map((edge) => ({ kind: "edge" as const, edge, reverse: false }));
    tryTasks(twoOptTasks([...nodeTasks, ...reqOnly], opts.start, opts.destination, costs, opts.mode));
  }

  if (items.length <= EXACT_MAX && bestCost === Number.POSITIVE_INFINITY) {
    bestTasks = items;
  } else if (items.length > EXACT_MAX) {
    bestTasks = twoOptTasks(bestTasks, opts.start, opts.destination, costs, opts.mode);
  }

  return bestTasks.map((t) =>
    t.kind === "node" ? { kind: "node" as const, node: t.node } : { kind: "edge" as const, edge: t.edge, reverse: t.reverse },
  );
}

/** Stitch a tour from an ordered plan; returns null if any leg is unreachable. */
export function buildTourFromPlan(
  graph: Graph,
  pairOf: Map<number, number>,
  edgeById: Map<number, SegmentEdge>,
  start: number,
  plan: TourStep[],
  mode: RouteMode,
  excluded: Set<number>,
): RouteResult | null {
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
    let leg = dijkstra(graph, current, target, mode, excluded, blocked);
    if (!leg) leg = dijkstra(graph, current, target, mode, excluded);
    if (!leg) return false;
    legs.push(leg);
    current = target;
    if (leg.segmentIds.length > 0) lastEdge = leg.segmentIds[leg.segmentIds.length - 1]!;
    return true;
  };

  const takeEdge = (e: SegmentEdge): void => {
    legs.push({
      nodeChain: [e.from, e.to],
      segmentIds: [e.id],
      lengthM: e.lengthM,
      durationMin: e.durationMin,
    });
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
    const revStored = revId !== undefined ? edgeById.get(revId) : undefined;
    const forward = step.reverse ? revStored : e;
    const backward = step.reverse ? e : revStored;
    if (forward && goTo(forward.from)) {
      takeEdge(forward);
    } else if (backward && goTo(backward.from)) {
      takeEdge(backward);
    } else {
      return null;
    }
  }

  if (legs.length === 0) {
    return { nodeChain: [start], segmentIds: [], lengthM: 0, durationMin: 0 };
  }

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
