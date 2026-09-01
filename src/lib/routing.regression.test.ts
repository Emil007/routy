import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

const FIXTURE_DB = path.join(process.cwd(), "data", "routy-2026-08-31.db");
const fixtureAvailable = existsSync(FIXTURE_DB);
if (fixtureAvailable) {
  process.env.DATABASE_PATH = FIXTURE_DB;
}

const { loadGraphContext } = fixtureAvailable ? await import("./routeContext") : { loadGraphContext: null };
const {
  backtrackScore,
  crossingScore,
  filterRequiredSegments,
  pickBest,
  scoreRoutes,
  searchRoutesWithConstraints,
} = fixtureAvailable ? await import("./routing") : ({} as never);
const { lengthBandForUser } = fixtureAvailable ? await import("./lengthTaste") : ({} as never);
const { getSettings } = fixtureAvailable ? await import("./settings") : ({} as never);
const { getUsageMap, getDailyUsageMap } = fixtureAvailable ? await import("./segments") : ({} as never);
const { getRouteScoringContext } = fixtureAvailable ? await import("./routeScoring") : ({} as never);
const { getGoldenMultiplierMap } = fixtureAvailable ? await import("./goldenSegments") : ({} as never);
const { getHomeAccessSegmentIds } = fixtureAvailable ? await import("./homeAccess") : ({} as never);

describe.skipIf(!fixtureAvailable)("routing regression (routy-2026-08-31.db)", () => {
  it("required segments 11+19 short route: clean perimeter loop, not ~2× detour", () => {
    const userId = 1;
    const homeNodeId = 1;
    const { graph, pairOf, segmentsById } = loadGraphContext!();
    const geometryOf = new Map([...segmentsById].map(([id, s]) => [id, s.geometry]));
    const band = lengthBandForUser(userId, "short");

    const { routes } = searchRoutesWithConstraints({
      graph,
      pairOf,
      start: homeNodeId,
      destination: homeNodeId,
      requiredSegmentIds: [11, 19],
      mode: "km",
      minValue: band.minM,
      maxValue: band.maxM,
      geometryOf,
    });

    expect(routes.length).toBeGreaterThan(0);

    const settings = getSettings();
    const ctx = getRouteScoringContext(userId, false);
    const scored = scoreRoutes(
      routes,
      pairOf,
      getUsageMap(userId),
      getDailyUsageMap(userId),
      settings.daily_diversity_weight,
      new Set(),
      band.targetM,
      "km",
      geometryOf,
      ctx.avoidSegmentIds,
      ctx.conditionCounts,
      ctx.staleSegmentIds,
      getGoldenMultiplierMap(),
      getHomeAccessSegmentIds(userId),
    );
    const best = pickBest(scored, new Set(), false, false, true);
    expect(best).not.toBeNull();

    expect(best!.backtrack).toBe(0);
    expect(best!.crossing).toBe(0);
    expect(best!.route.lengthM).toBeLessThan(4000);
    expect(best!.route.lengthM).toBeGreaterThan(1500);

    const set = new Set(best!.route.segmentIds);
    expect(set.has(11) || set.has(12)).toBe(true);
    expect(set.has(19) || set.has(20)).toBe(true);

    const cleanFeasible = filterRequiredSegments(routes, [11, 19], pairOf).filter(
      (r) => backtrackScore(r.segmentIds, pairOf) === 0 && crossingScore(r.segmentIds, geometryOf) === 0,
    );
    const minClean = Math.min(...cleanFeasible.map((r) => r.lengthM));
    expect(best!.route.lengthM).toBe(minClean);
  });
});
