import { dijkstra } from "./routeSearch";
import type { Graph, RouteMode, RouteResult } from "./routing";

/** Build a node guide chain: shortest legs between consecutive nodes, loop back to start when requested. */
export function buildGuideRoute(
  graph: Graph,
  orderedNodeIds: number[],
  loopBack: boolean,
  mode: RouteMode = "km",
  excluded: Set<number> = new Set(),
): RouteResult | null {
  if (orderedNodeIds.length === 0) return null;

  const chain: number[] = [orderedNodeIds[0]!];
  const segmentIds: number[] = [];
  let lengthM = 0;
  let durationMin = 0;

  const legs: number[][] = [];
  for (let i = 0; i < orderedNodeIds.length - 1; i++) {
    legs.push([orderedNodeIds[i]!, orderedNodeIds[i + 1]!]);
  }
  if (loopBack && orderedNodeIds.length > 1) {
    legs.push([orderedNodeIds[orderedNodeIds.length - 1]!, orderedNodeIds[0]!]);
  }

  for (const [from, to] of legs) {
    if (from === to) continue;
    const leg = dijkstra(graph, from, to, mode, excluded);
    if (!leg || leg.segmentIds.length === 0) return null;
    for (let i = 1; i < leg.nodeChain.length; i++) {
      const n = leg.nodeChain[i]!;
      if (chain[chain.length - 1] !== n) chain.push(n);
    }
    segmentIds.push(...leg.segmentIds);
    lengthM += leg.lengthM;
    durationMin += leg.durationMin;
  }

  return { nodeChain: chain, segmentIds, lengthM, durationMin };
}

/** Direct chain for guide mode (visit order only, no graph legs). */
export function guideNodeChain(orderedNodeIds: number[], loopBack: boolean): number[] {
  if (orderedNodeIds.length === 0) return [];
  if (!loopBack || orderedNodeIds.length === 1) return [...orderedNodeIds];
  return [...orderedNodeIds, orderedNodeIds[0]!];
}

/** Infer loop-back from stored guide visit ids and routing chain. */
export function guideLoopBack(guideNodeIds: number[], nodeChain: number[]): boolean {
  if (guideNodeIds.length <= 1) return false;
  return nodeChain.length > 0 && nodeChain[0] === nodeChain[nodeChain.length - 1];
}
