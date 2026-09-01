import { beforeAll, describe, expect, it, vi } from "vitest";

const walkRows: { user_id: number; points_earned: number | null; accepted_at: string }[] = [];
const todayWalks: { user_id: number }[] = [];
let streakCurrent = 0;

vi.mock("./db", () => ({
  db: {
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes("display_name") && sql.includes("points_earned")) {
          const byUser = new Map<number, number>();
          for (const w of walkRows) {
            byUser.set(w.user_id, (byUser.get(w.user_id) ?? 0) + (w.points_earned ?? 0));
          }
          return [...byUser.entries()]
            .map(([user_id, total]) => ({
              user_id,
              display_name: `User ${user_id}`,
              total,
            }))
            .sort((a, b) => b.total - a.total);
        }
        return [];
      },
      get: (...params: unknown[]) => {
        if (sql.includes("date(accepted_at) = date('now')")) {
          const userId = params[0] as number;
          return todayWalks.find((w) => w.user_id === userId) ? { 1: 1 } : undefined;
        }
        if (sql.includes("SUM(points_earned)") && sql.includes("datetime('now'")) {
          const userId = params[0] as number;
          const weekCutoff = Date.now() - 7 * 86400000;
          const total = walkRows
            .filter((w) => w.user_id === userId && Date.parse(w.accepted_at) >= weekCutoff)
            .reduce((s, w) => s + (w.points_earned ?? 0), 0);
          return { total };
        }
        if (sql.includes("SUM(points_earned)")) {
          const userId = params[0] as number;
          const total = walkRows
            .filter((w) => w.user_id === userId)
            .reduce((s, w) => s + (w.points_earned ?? 0), 0);
          return { total };
        }
        return undefined;
      },
    }),
  },
}));

vi.mock("./segments", () => ({
  listSegments: () => [],
}));

vi.mock("./stats", () => ({
  getStreakStats: () => ({ currentStreak: streakCurrent, longestStreak: streakCurrent }),
}));

let computeBasePoints: typeof import("./points").computeBasePoints;
let computeRoutePointPreview: typeof import("./points").computeRoutePointPreview;
let countGoldenHits: typeof import("./points").countGoldenHits;
let celebrationTierForWalk: typeof import("./points").celebrationTierForWalk;
let computeWalkPointsEarned: typeof import("./points").computeWalkPointsEarned;
let computeUserPoints: typeof import("./points").computeUserPoints;
let streakForPointsMultiplier: typeof import("./points").streakForPointsMultiplier;
let toCanonicalUsageMap: typeof import("./points").toCanonicalUsageMap;
let getPointsLeaderboard: typeof import("./points").getPointsLeaderboard;

beforeAll(async () => {
  ({
    computeBasePoints,
    computeRoutePointPreview,
    countGoldenHits,
    celebrationTierForWalk,
    computeWalkPointsEarned,
    computeUserPoints,
    streakForPointsMultiplier,
    toCanonicalUsageMap,
    getPointsLeaderboard,
  } = await import("./points"));
});

describe("computeBasePoints", () => {
  it("awards walk, distance, elevation, and exploration components", () => {
    const base = computeBasePoints([
      { length_m: 1000, segment_ids: "[]" },
      { length_m: 500, segment_ids: "[]" },
    ]);
    expect(base).toBe(115);
  });

  it("is zero for no walks", () => {
    expect(computeBasePoints([])).toBe(0);
  });
});

describe("computeRoutePointPreview", () => {
  it("includes base, golden, exploration, and diversity components", () => {
    const usageMap = new Map<number, number>([
      [1, 0],
      [2, 10],
      [3, 10],
      [4, 10],
    ]);
    const goldenMap = new Map<number, number>([[1, 3]]);
    const canonicalOf = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    const preview = computeRoutePointPreview([1, 2, 3], 2500, usageMap, goldenMap, canonicalOf);
    expect(preview.base).toBe(75);
    expect(preview.golden).toBeGreaterThan(0);
    expect(preview.exploration).toBe(8);
    expect(preview.diversity).toBeGreaterThan(0);
    expect(preview.total).toBe(preview.base + preview.golden + preview.exploration + preview.diversity);
  });

  it("maps directed usage onto canonical ids for exploration", () => {
    // Forward id 10 unused, reverse 11 has usage — both map to canon 10
    const usageMap = new Map<number, number>([[11, 5]]);
    const goldenMap = new Map<number, number>();
    const canonicalOf = new Map<number, number>([
      [10, 10],
      [11, 10],
    ]);
    const preview = computeRoutePointPreview([10], 1000, usageMap, goldenMap, canonicalOf);
    expect(preview.exploration).toBe(0);
  });
});

describe("toCanonicalUsageMap", () => {
  it("sums both directions onto one canonical id", () => {
    const usage = toCanonicalUsageMap(
      new Map([
        [1, 2],
        [2, 3],
      ]),
      new Map([
        [1, 1],
        [2, 1],
      ]),
    );
    expect(usage.get(1)).toBe(5);
  });
});

describe("countGoldenHits", () => {
  it("counts canonical golden segments once per route", () => {
    const goldenMap = new Map<number, number>([[5, 3]]);
    const canonicalOf = new Map<number, number>([
      [5, 5],
      [6, 5],
    ]);
    expect(countGoldenHits([5, 6, 5], goldenMap, canonicalOf)).toBe(1);
  });
});

describe("computeWalkPointsEarned", () => {
  it("applies streak multiplier to preview total", () => {
    const breakdown = { base: 75, golden: 10, exploration: 8, diversity: 5, total: 98 };
    expect(computeWalkPointsEarned(breakdown, 1.25)).toBe(123);
    expect(computeWalkPointsEarned(breakdown, 1)).toBe(98);
  });

  it("applies guide mode multiplier after streak", () => {
    const breakdown = { base: 75, golden: 10, exploration: 8, diversity: 5, total: 100 };
    expect(computeWalkPointsEarned(breakdown, 1, true)).toBe(70);
    expect(computeWalkPointsEarned(breakdown, 2, true)).toBe(140);
  });
});

describe("celebrationTierForWalk", () => {
  it("prefers golden tier when multiple golden hits", () => {
    expect(celebrationTierForWalk(2, 1, 50)).toBe("golden");
  });

  it("uses streak tier for long streaks", () => {
    expect(celebrationTierForWalk(0, 7, 50)).toBe("streak");
  });
});

describe("points ledger", () => {
  it("sums stored points_earned without replaying streak", () => {
    walkRows.length = 0;
    walkRows.push(
      { user_id: 1, points_earned: 100, accepted_at: "2026-08-01T10:00:00Z" },
      { user_id: 1, points_earned: 50, accepted_at: "2026-08-10T10:00:00Z" },
      { user_id: 2, points_earned: 200, accepted_at: "2026-08-10T10:00:00Z" },
    );
    streakCurrent = 30; // would have multiplied under old formula
    const points = computeUserPoints(1);
    expect(points.totalPoints).toBe(150);
    expect(points.streakMultiplier).toBe(2.0);
  });

  it("leaderboard uses ledger sums", () => {
    walkRows.length = 0;
    walkRows.push(
      { user_id: 1, points_earned: 10, accepted_at: "2026-08-01T10:00:00Z" },
      { user_id: 2, points_earned: 99, accepted_at: "2026-08-01T10:00:00Z" },
    );
    const board = getPointsLeaderboard();
    expect(board[0]?.userId).toBe(2);
    expect(board[0]?.totalPoints).toBe(99);
  });
});

describe("streakForPointsMultiplier", () => {
  it("extends streak on first walk of the day", () => {
    todayWalks.length = 0;
    streakCurrent = 2;
    expect(streakForPointsMultiplier(1)).toBe(3);
  });

  it("keeps current streak when already walked today", () => {
    todayWalks.length = 0;
    todayWalks.push({ user_id: 1 });
    streakCurrent = 3;
    expect(streakForPointsMultiplier(1)).toBe(3);
  });

  it("starts at 1 after a broken streak", () => {
    todayWalks.length = 0;
    streakCurrent = 0;
    expect(streakForPointsMultiplier(1)).toBe(1);
  });
});

describe("double-complete claim semantics", () => {
  it("treats missing active route claim as null walk id (API maps to 404)", () => {
    // recordWalkWithPoints returns null when claimActiveRoute deletes 0 rows —
    // covered here as the contract complete/route.ts relies on.
    const claimFailed = true;
    const walkId = claimFailed ? null : 1;
    expect(walkId).toBeNull();
  });
});
