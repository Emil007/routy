import { getAvoidSegmentSet } from "./avoidList";
import { getConditionPenaltyMap } from "./segmentConditions";
import { getStaleSegmentSet } from "./userSegments";

export const STALE_SEGMENT_DAYS = 30;

/** Shared inputs for scoreRoutes / pickBest on authenticated route endpoints. */
export function getRouteScoringContext(userId: number, surpriseMode: boolean) {
  return {
    avoidSegmentIds: getAvoidSegmentSet(userId),
    conditionCounts: getConditionPenaltyMap(),
    staleSegmentIds: surpriseMode ? getStaleSegmentSet(userId, STALE_SEGMENT_DAYS) : new Set<number>(),
  };
}
