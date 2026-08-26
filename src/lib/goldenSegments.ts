import { db } from "./db";
import { directedPairIds, listSegments } from "./segments";
import { canonicalSegmentId } from "./points";
import { getSettings } from "./settings";

const GOLDEN_MULTIPLIER = 3;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface GoldenSegment {
  segmentId: number;
  multiplier: number;
}

/** Count of golden picks for a network size given percent (default from settings). */
export function goldenCountForNetwork(canonicalCount: number, percent?: number): number {
  if (canonicalCount <= 0) return 0;
  const pct = percent ?? getSettings().golden_percent ?? 5;
  const clamped = Math.min(25, Math.max(1, pct));
  return Math.max(1, Math.round((canonicalCount * clamped) / 100));
}

/** Live preview: how many goldens would be picked at this percent (does not re-roll today). */
export function previewGoldenPick(percent: number): { picked: number; total: number } {
  const canonical = new Set<number>();
  for (const s of listSegments()) {
    if (s.deletedAt || (s.lockedUntil && s.lockedUntil > new Date().toISOString())) continue;
    canonical.add(canonicalSegmentId(s));
  }
  const total = canonical.size;
  return { picked: goldenCountForNetwork(total, percent), total };
}

/** Pick golden segments from the lowest-usage quartile, weighted toward even lower usage. */
export function pickGoldenSegmentIds(
  canonicalUsage: [segmentId: number, usage: number][],
  count: number,
): number[] {
  if (canonicalUsage.length === 0) return [];

  const sorted = [...canonicalUsage].sort((a, b) => a[1] - b[1]);
  const quartileSize = Math.max(count, Math.ceil(sorted.length * 0.25));
  const pool = sorted.slice(0, quartileSize);
  const picked: number[] = [];
  const remaining = [...pool];

  while (picked.length < count && remaining.length > 0) {
    const weights = remaining.map(([, usage]) => 1 / (usage + 1));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index]![0]!);
    remaining.splice(index, 1);
  }

  if (picked.length < count) {
    for (const [id] of sorted) {
      if (picked.length >= count) break;
      if (!picked.includes(id)) picked.push(id);
    }
  }

  return picked;
}

/** Seed shared daily goldens from network-wide usage (SUM across all users). */
export function ensureTodayGoldenSegments(): GoldenSegment[] {
  const date = utcDateString();
  const existing = db
    .prepare("SELECT segment_id, multiplier FROM golden_segments WHERE utc_date = ?")
    .all(date) as { segment_id: number; multiplier: number }[];
  if (existing.length > 0) {
    return existing.map((r) => ({ segmentId: r.segment_id, multiplier: r.multiplier }));
  }

  const usageRows = db
    .prepare(
      `SELECT segment_id, SUM(usage_count) AS usage_count
       FROM user_segment_usage
       GROUP BY segment_id`,
    )
    .all() as { segment_id: number; usage_count: number }[];
  const usageMap = new Map(usageRows.map((r) => [r.segment_id, Number(r.usage_count)]));

  const canonical = new Map<number, number>();
  for (const s of listSegments()) {
    if (s.deletedAt || (s.lockedUntil && s.lockedUntil > new Date().toISOString())) continue;
    const canon = canonicalSegmentId(s);
    if (!canonical.has(canon)) {
      const forward = usageMap.get(s.id) ?? 0;
      const reverse = s.reverseOf != null ? (usageMap.get(s.reverseOf) ?? 0) : 0;
      // Prefer summing both directions for the physical path when both have rows.
      canonical.set(canon, forward + reverse);
    }
  }

  const picked = pickGoldenSegmentIds([...canonical.entries()], goldenCountForNetwork(canonical.size));

  const insert = db.prepare(
    "INSERT OR IGNORE INTO golden_segments (utc_date, segment_id, multiplier) VALUES (?, ?, ?)",
  );
  for (const segmentId of picked) {
    insert.run(date, segmentId, GOLDEN_MULTIPLIER);
  }

  return picked.map((segmentId) => ({ segmentId, multiplier: GOLDEN_MULTIPLIER }));
}

export function getTodayGoldenSegmentIds(): number[] {
  return ensureTodayGoldenSegments().map((g) => g.segmentId);
}

export function getGoldenMultiplierMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of ensureTodayGoldenSegments()) {
    for (const id of directedPairIds(g.segmentId)) {
      map.set(id, g.multiplier);
    }
  }
  return map;
}
