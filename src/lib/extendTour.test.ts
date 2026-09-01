import { describe, expect, it } from "vitest";
import { buildGraph, buildPairMap, type SegmentEdge } from "./routing";
import { extendCoreTour } from "./extendTour";

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

describe("extendCoreTour trim when over max", () => {
  const graph = buildGraph(edges);
  const pairOf = buildPairMap(reversePairs);
  const excluded = new Set<number>();

  it("removes a spur suffix when the tour exceeds maxValue", () => {
    // Perimeter 400 m, then duplicate loopVia spur 1→3→1 (+400 m) = 800 m total.
    const perimeter = {
      nodeChain: [1, 2, 3, 4, 1],
      segmentIds: [1, 2, 3, 4],
      lengthM: 4 * LEG_M,
      durationMin: 4 * LEG_MIN,
    };
    const spurSuffix = {
      nodeChain: [1, 2, 3, 4, 1],
      segmentIds: [1, 2, 3, 4],
      lengthM: 4 * LEG_M,
      durationMin: 4 * LEG_MIN,
    };
    const core = {
      nodeChain: [...perimeter.nodeChain, ...spurSuffix.nodeChain.slice(1)],
      segmentIds: [...perimeter.segmentIds, ...spurSuffix.segmentIds],
      lengthM: perimeter.lengthM + spurSuffix.lengthM,
      durationMin: perimeter.durationMin + spurSuffix.durationMin,
    };
    expect(core.lengthM).toBe(800);

    const result = extendCoreTour(core, graph, pairOf, 1, 1, "km", excluded, 200, 450);
    expect(result.route.lengthM).toBeLessThanOrEqual(450);
    expect(result.route.lengthM).toBeLessThan(core.lengthM);
    expect(result.route.lengthM).toBe(400);
  });
});
