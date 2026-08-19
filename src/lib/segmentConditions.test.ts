import { describe, expect, it } from "vitest";
import { reportCondition, purgeExpiredConditions, CONDITION_REASONS } from "./segmentConditions";

describe("segmentConditions", () => {
  it("exports known reason enums", () => {
    expect(CONDITION_REASONS).toContain("muddy");
    expect(CONDITION_REASONS).toContain("overgrown");
  });

  it("returns null when segment does not exist", () => {
    expect(reportCondition(999999, "dog", 1)).toBeNull();
  });

  it("purgeExpiredConditions runs without error", () => {
    expect(purgeExpiredConditions()).toBeGreaterThanOrEqual(0);
  });
});
