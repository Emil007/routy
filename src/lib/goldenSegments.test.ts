import { describe, expect, it } from "vitest";
import { pickGoldenSegmentIds } from "./goldenSegments";

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
    const picked = pickGoldenSegmentIds(usage, 5);
    expect(picked).toHaveLength(5);
    expect(picked.every((id) => id <= 5)).toBe(true);
  });

  it("returns fewer ids when the network is smaller than the requested count", () => {
    expect(pickGoldenSegmentIds([[1, 0], [2, 1]], 5)).toEqual([1, 2]);
  });
});
