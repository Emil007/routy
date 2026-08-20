import { describe, expect, it } from "vitest";
import { pickGoldenSegmentIds, goldenCountForNetwork } from "./goldenSegments";

describe("goldenCountForNetwork", () => {
  it("returns 0 for an empty network", () => {
    expect(goldenCountForNetwork(0)).toBe(0);
  });

  it("returns at least 1 for a small network", () => {
    expect(goldenCountForNetwork(3)).toBe(1);
    expect(goldenCountForNetwork(10)).toBe(1);
  });

  it("scales to about 5% of larger networks", () => {
    expect(goldenCountForNetwork(100)).toBe(5);
    expect(goldenCountForNetwork(40)).toBe(2);
  });
});

describe("pickGoldenSegmentIds", () => {
  it("picks from the lowest-usage quartile only", () => {
    const usage: [number, number][] = [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 10],
      [5, 20],
      [6, 30],
      [7, 40],
      [8, 50],
    ];
    const count = goldenCountForNetwork(usage.length);
    const picked = pickGoldenSegmentIds(usage, count);
    expect(picked).toHaveLength(count);
    expect(picked.every((id) => id <= 5)).toBe(true);
  });

  it("returns fewer ids when the network is smaller than the requested count", () => {
    const picked = pickGoldenSegmentIds([[1, 0], [2, 1]], 5);
    expect(picked).toHaveLength(2);
    expect(new Set(picked)).toEqual(new Set([1, 2]));
  });
});
