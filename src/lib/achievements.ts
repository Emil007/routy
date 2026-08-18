import { db } from "./db";
import { getUserStats, getStreakStats, getUserSegmentWalkCounts } from "./stats";
import { listSegments, isCanonicalSegment } from "./segments";
import { favoriteCount } from "./favorites";
import { t, type Locale } from "./i18n";

export const TIERS = ["stein", "blech", "bronze", "silber", "gold", "platin", "diamant"] as const;
export type Tier = (typeof TIERS)[number];

export interface ScalableAchievement {
  category: "walks" | "distance" | "streak" | "exploration";
  categoryLabel: string;
  tierIndex: number; // -1 = no tier reached yet
  tierLabel: string | null;
  progressLabel: string;
}

export interface SpecialAchievement {
  id: "trailblazer" | "collector" | "earlyBird" | "nightOwl";
  label: string;
  description: string;
  earned: boolean;
}

export interface Achievements {
  scalable: ScalableAchievement[];
  special: SpecialAchievement[];
}

const WALK_THRESHOLDS = [1, 5, 15, 50, 100, 250, 500];
const DISTANCE_KM_THRESHOLDS = [5, 25, 100, 250, 500, 1000, 2500];
const STREAK_DAY_THRESHOLDS = [2, 3, 7, 14, 30, 60, 100];
const EXPLORATION_PERCENT_THRESHOLDS = [10, 25, 50, 75, 100];

function tierIndexFor(value: number, thresholds: number[]): number {
  let index = -1;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) index = i;
    else break;
  }
  return index;
}

function numericAchievement(
  locale: Locale,
  category: "walks" | "distance" | "streak",
  categoryLabel: string,
  value: number,
  thresholds: number[],
  unit: string,
): ScalableAchievement {
  const tierIndex = tierIndexFor(value, thresholds);
  const tierLabel = tierIndex >= 0 ? t(locale, `achievements.tiers.${TIERS[tierIndex]}`) : null;
  const progressLabel =
    tierIndex + 1 < thresholds.length
      ? t(locale, "achievements.progressToNext", {
          current: Math.floor(value),
          next: thresholds[tierIndex + 1],
          unit,
          tier: t(locale, `achievements.tiers.${TIERS[tierIndex + 1]}`),
        })
      : t(locale, "achievements.maxTierReached", { tier: tierLabel ?? "" });
  return { category, categoryLabel, tierIndex, tierLabel, progressLabel };
}

/** Exploration has 7 tiers too, but split across two different metrics: percent of
 * the network explored at least once (stein..gold), then how many times *every*
 * segment has been walked, once the network is fully explored (platin, diamant). */
function explorationTierIndex(percent: number, minVisits: number): number {
  if (percent < 100) return tierIndexFor(percent, EXPLORATION_PERCENT_THRESHOLDS);
  if (minVisits < 2) return 4; // gold
  if (minVisits < 5) return 5; // platin
  return 6; // diamant
}

function explorationAchievement(locale: Locale, percent: number, minVisits: number): ScalableAchievement {
  const tierIndex = explorationTierIndex(percent, minVisits);
  const tierLabel = tierIndex >= 0 ? t(locale, `achievements.tiers.${TIERS[tierIndex]}`) : null;

  let progressLabel: string;
  if (tierIndex >= 6) {
    progressLabel = t(locale, "achievements.maxTierReached", { tier: tierLabel ?? "" });
  } else if (tierIndex < 4) {
    const nextPercent = EXPLORATION_PERCENT_THRESHOLDS[tierIndex + 1];
    progressLabel = t(locale, "achievements.explorationPercentProgress", {
      current: Math.floor(percent),
      next: nextPercent,
      tier: t(locale, `achievements.tiers.${TIERS[tierIndex + 1]}`),
    });
  } else {
    const nextVisits = tierIndex === 4 ? 2 : 5;
    progressLabel = t(locale, "achievements.explorationVisitsProgress", {
      current: minVisits,
      next: nextVisits,
      tier: t(locale, `achievements.tiers.${TIERS[tierIndex + 1]}`),
    });
  }

  return { category: "exploration", categoryLabel: t(locale, "achievements.categories.exploration"), tierIndex, tierLabel, progressLabel };
}

function minSegmentVisits(userId: number): number {
  const canonicalIds = listSegments().filter(isCanonicalSegment).map((s) => s.id);
  if (canonicalIds.length === 0) return 0;
  const counts = getUserSegmentWalkCounts(userId);
  return Math.min(...canonicalIds.map((id) => counts.get(id) ?? 0));
}

export function computeAchievements(userId: number, locale: Locale): Achievements {
  const stats = getUserStats(userId);
  const streak = getStreakStats(userId);
  const percentExplored = stats.totalSegments > 0 ? (stats.segmentsExplored / stats.totalSegments) * 100 : 0;

  const trailblazer =
    (db.prepare("SELECT COUNT(*) c FROM segments WHERE submitted_by = ?").get(userId) as { c: number }).c > 0;
  const earlyBird =
    (
      db
        .prepare("SELECT COUNT(*) c FROM walk_log WHERE user_id = ? AND CAST(strftime('%H', accepted_at) AS INTEGER) < 7")
        .get(userId) as { c: number }
    ).c > 0;
  const nightOwl =
    (
      db
        .prepare("SELECT COUNT(*) c FROM walk_log WHERE user_id = ? AND CAST(strftime('%H', accepted_at) AS INTEGER) >= 22")
        .get(userId) as { c: number }
    ).c > 0;

  return {
    scalable: [
      numericAchievement(locale, "walks", t(locale, "achievements.categories.walks"), stats.walkCount, WALK_THRESHOLDS, t(locale, "achievements.units.walks")),
      numericAchievement(
        locale,
        "distance",
        t(locale, "achievements.categories.distance"),
        stats.totalLengthM / 1000,
        DISTANCE_KM_THRESHOLDS,
        t(locale, "achievements.units.distance"),
      ),
      numericAchievement(
        locale,
        "streak",
        t(locale, "achievements.categories.streak"),
        streak.longestStreak,
        STREAK_DAY_THRESHOLDS,
        t(locale, "achievements.units.streak"),
      ),
      explorationAchievement(locale, percentExplored, stats.totalSegments > 0 ? minSegmentVisits(userId) : 0),
    ],
    special: [
      {
        id: "trailblazer",
        label: t(locale, "achievements.special.trailblazer"),
        description: t(locale, "achievements.special.trailblazerDesc"),
        earned: trailblazer,
      },
      {
        id: "collector",
        label: t(locale, "achievements.special.collector"),
        description: t(locale, "achievements.special.collectorDesc"),
        earned: favoriteCount(userId) > 0,
      },
      {
        id: "earlyBird",
        label: t(locale, "achievements.special.earlyBird"),
        description: t(locale, "achievements.special.earlyBirdDesc"),
        earned: earlyBird,
      },
      {
        id: "nightOwl",
        label: t(locale, "achievements.special.nightOwl"),
        description: t(locale, "achievements.special.nightOwlDesc"),
        earned: nightOwl,
      },
    ],
  };
}
