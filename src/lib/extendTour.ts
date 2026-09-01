/**
 * Length extension / trim (0.46 phase 2): fit a core tour to the preset band by
 * adding a low-shape spur loop, without disturbing required segments on the core.
 */
import type { Graph, RouteMode, RouteResult } from "./routing";
import { dijkstra } from "./routeSearch";

function concat(a: RouteResult, b: RouteResult): RouteResult {
  const nodeChain = [...a.nodeChain, ...b.nodeChain.slice(1)];
  return {
    nodeChain,
    segmentIds: [...a.segmentIds, ...b.segmentIds],
    lengthM: a.lengthM + b.lengthM,
    durationMin: a.durationMin + b.durationMin,
  };
}

function canonicalBlock(segmentIds: number[], pairOf: Map<number, number>): Set<number> {
  const s = new Set<number>();
  for (const id of segmentIds) {
    s.add(id);
    const p = pairOf.get(id);
    if (p !== undefined) s.add(p);
  }
  return s;
}

/** Genuine loop start → m → start avoiding retracing outbound paths. */
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
  if (leg2) return concat(leg1, leg2);
  const back = dijkstra(graph, m, start, mode, excluded);
  return back ? concat(leg1, back) : null;
}

export interface ExtendedRoute {
  route: RouteResult;
  coreLengthM: number;
  extensionLengthM: number;
}

function routeValue(r: RouteResult, mode: RouteMode): number {
  return mode === "km" ? r.lengthM : r.durationMin;
}

/**
 * Extend a core tour when it is shorter than minValue by appending an out-and-back
 * spur from a node on the core (prefer the start/end for loops).
 */
export function extendCoreTour(
  core: RouteResult,
  graph: Graph,
  pairOf: Map<number, number>,
  start: number,
  destination: number,
  mode: RouteMode,
  excluded: Set<number>,
  minValue: number,
  maxValue: number,
): ExtendedRoute {
  const coreLen = routeValue(core, mode);
  if (coreLen >= minValue && coreLen <= maxValue) {
    return { route: core, coreLengthM: core.lengthM, extensionLengthM: 0 };
  }
  if (coreLen > maxValue) {
    return { route: core, coreLengthM: core.lengthM, extensionLengthM: 0 };
  }

  const anchor = start === destination ? start : destination;
  const candidates = new Set<number>([anchor]);
  for (const n of core.nodeChain) candidates.add(n);

  let best: ExtendedRoute | null = null;
  for (const m of candidates) {
    if (m === anchor) continue;
    const spur = loopVia(graph, pairOf, anchor, m, mode, excluded);
    if (!spur) continue;
    const combined =
      start === destination
        ? concat(core, spur)
        : concat(core, dijkstra(graph, core.nodeChain[core.nodeChain.length - 1]!, anchor, mode, excluded) ?? spur);
    const val = routeValue(combined, mode);
    if (val > maxValue * 1.35) continue;
    const ext = combined.lengthM - core.lengthM;
    const candidate: ExtendedRoute = { route: combined, coreLengthM: core.lengthM, extensionLengthM: Math.max(0, ext) };
    if (!best || Math.abs(val - minValue) < Math.abs(routeValue(best.route, mode) - minValue)) {
      best = candidate;
    }
  }

  return best ?? { route: core, coreLengthM: core.lengthM, extensionLengthM: 0 };
}
