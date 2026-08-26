/**
 * Compact route-quality snapshot for logging / API (0.44).
 * Ranking still uses scoreRoutes / pickBest — this is an explicit measurable summary.
 */
import type { ScoredRoute } from "./routing";

export interface RouteQuality {
  lengthM: number;
  backtrack: number;
  crossing: number;
  homeConnectors: number;
  unexplored: number;
}

export function routeQualityFromScored(scored: ScoredRoute): RouteQuality {
  return {
    lengthM: scored.route.lengthM,
    backtrack: scored.backtrack,
    crossing: scored.crossing,
    homeConnectors: scored.homeConnectors,
    unexplored: scored.unexplored,
  };
}
