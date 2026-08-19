import { describe, expect, it } from "vitest";
import { db } from "./db";
import { reportCondition, purgeExpiredConditions, CONDITION_REASONS } from "./segmentConditions";
import { listSegments } from "./segments";

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

  it("purges conditions past sqlite datetime expiry", () => {
    const segment = listSegments()[0];
    if (!segment) return;

    const created = reportCondition(segment.id, "muddy", 1, 7);
    expect(created).not.toBeNull();
    if (!created) return;

    db.prepare("UPDATE segment_condition SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(created.id);
    expect(purgeExpiredConditions()).toBeGreaterThanOrEqual(1);

    const row = db.prepare("SELECT id FROM segment_condition WHERE id = ?").get(created.id);
    expect(row).toBeUndefined();
  });
});
