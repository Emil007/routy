import { db } from "./db";
import { getPointsLeaderboard, type PointsLeaderboardEntry } from "./points";
import { canonicalSegmentId, isCanonicalSegment, listSegments } from "./segments";

export interface AdminInsights {
  walksLast7Days: number;
  walksThisWeek: number;
  goldenHitWalksLast7Days: number;
  goldenHitRateLast7Days: number;
  pendingLockProposals: number;
  segmentsWalked: number;
  totalCanonicalSegments: number;
  topWalkers: PointsLeaderboardEntry[];
}

/** Monday 00:00 UTC of the current ISO week, as SQLite datetime string. */
function startOfIsoWeekUtcSql(): string {
  // strftime('%w') = 0 Sunday … 6 Saturday; days since Monday = (w + 6) % 7
  const row = db
    .prepare(
      `SELECT date('now', '-' || ((CAST(strftime('%w', 'now') AS INTEGER) + 6) % 7) || ' days') AS d`,
    )
    .get() as { d: string };
  return `${row.d} 00:00:00`;
}

function countWalksSince(sinceIso: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM walk_log WHERE accepted_at >= ?")
    .get(sinceIso) as { c: number };
  return row.c;
}

function countGoldenHitWalksSince(sinceIso: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM walk_log WHERE accepted_at >= ? AND COALESCE(golden_hits, 0) > 0",
    )
    .get(sinceIso) as { c: number };
  return row.c;
}

function countPendingLockProposals(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM segment_lock_proposal WHERE status = 'pending'")
    .get() as { c: number };
  return row.c;
}

/** Household coverage: distinct canonical segments walked at least once / total canonical. */
function segmentCoverage(): { walked: number; total: number } {
  const segments = listSegments();
  const canonicalOf = new Map(segments.map((s) => [s.id, canonicalSegmentId(s)]));
  const total = segments.filter(isCanonicalSegment).length;

  const rows = db.prepare("SELECT segment_ids FROM walk_log").all() as { segment_ids: string }[];
  const walked = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.segment_ids) as number[]) {
      const canon = canonicalOf.get(id);
      if (canon !== undefined) walked.add(canon);
    }
  }
  return { walked: walked.size, total };
}

export function getAdminInsights(): AdminInsights {
  const weekStart = startOfIsoWeekUtcSql();
  const sevenDaysAgo = db
    .prepare("SELECT datetime('now', '-7 days') AS d")
    .get() as { d: string };

  const walksLast7Days = countWalksSince(sevenDaysAgo.d);
  const walksThisWeek = countWalksSince(weekStart);
  const goldenHitWalksLast7Days = countGoldenHitWalksSince(sevenDaysAgo.d);
  const { walked, total } = segmentCoverage();

  return {
    walksLast7Days,
    walksThisWeek,
    goldenHitWalksLast7Days,
    goldenHitRateLast7Days: walksLast7Days > 0 ? goldenHitWalksLast7Days / walksLast7Days : 0,
    pendingLockProposals: countPendingLockProposals(),
    segmentsWalked: walked,
    totalCanonicalSegments: total,
    topWalkers: getPointsLeaderboard(5),
  };
}
