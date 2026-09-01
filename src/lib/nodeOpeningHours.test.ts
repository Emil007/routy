import { describe, expect, it } from "vitest";
import { isNodeOpenAt, closedNodeIds, localMinutesFromMidnight } from "./nodeOpeningHours";

describe("localMinutesFromMidnight", () => {
  it("returns minutes from midnight in local time", () => {
    const d = new Date(2026, 0, 15, 14, 30);
    expect(localMinutesFromMidnight(d)).toBe(14 * 60 + 30);
  });
});

describe("isNodeOpenAt", () => {
  it("treats null hours as always open", () => {
    expect(isNodeOpenAt({ openFromMinutes: null, openUntilMinutes: null })).toBe(true);
  });

  it("checks same-day windows", () => {
    const morning = new Date(2026, 0, 15, 9, 0);
    expect(isNodeOpenAt({ openFromMinutes: 8 * 60, openUntilMinutes: 18 * 60 }, morning)).toBe(true);
    const evening = new Date(2026, 0, 15, 20, 0);
    expect(isNodeOpenAt({ openFromMinutes: 8 * 60, openUntilMinutes: 18 * 60 }, evening)).toBe(false);
  });

  it("supports overnight windows", () => {
    const late = new Date(2026, 0, 15, 23, 0);
    const early = new Date(2026, 0, 15, 5, 0);
    const hours = { openFromMinutes: 22 * 60, openUntilMinutes: 6 * 60 };
    expect(isNodeOpenAt(hours, late)).toBe(true);
    expect(isNodeOpenAt(hours, early)).toBe(true);
    const midday = new Date(2026, 0, 15, 12, 0);
    expect(isNodeOpenAt(hours, midday)).toBe(false);
  });
});

describe("closedNodeIds", () => {
  it("returns ids of closed nodes", () => {
    const noon = new Date(2026, 0, 15, 12, 0);
    const nodes = [
      { id: 1, openFromMinutes: null, openUntilMinutes: null },
      { id: 2, openFromMinutes: 8 * 60, openUntilMinutes: 18 * 60 },
      { id: 3, openFromMinutes: 8 * 60, openUntilMinutes: 10 * 60 },
    ];
    expect(closedNodeIds(nodes, noon)).toEqual([3]);
  });
});
