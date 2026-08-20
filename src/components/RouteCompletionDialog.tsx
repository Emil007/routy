"use client";

import { t, type Locale } from "@/lib/i18n";
import type { PointPreviewBreakdown } from "@/lib/points";

export interface RouteCompletionData {
  pointsEarned: number;
  streakMultiplier: number;
  currentStreak: number;
  pointBreakdown?: PointPreviewBreakdown;
  goldenHits?: number;
  celebrationTier?: string;
}

function celebrationTitle(locale: Locale, tier?: string): string {
  if (tier === "golden") return t(locale, "route.celebrationGolden");
  if (tier === "streak") return t(locale, "route.celebrationStreak");
  if (tier === "achievement") return t(locale, "route.celebrationAchievement");
  return t(locale, "route.completionTitle");
}

function PointPreviewLines({ locale, breakdown }: { locale: Locale; breakdown: PointPreviewBreakdown }) {
  return (
    <div className="completion-breakdown">
      <span className="chip">{t(locale, "route.pointPreviewBase", { points: breakdown.base })}</span>
      {breakdown.golden > 0 && (
        <span className="chip">{t(locale, "route.pointPreviewGolden", { points: breakdown.golden })}</span>
      )}
      {breakdown.exploration > 0 && (
        <span className="chip">{t(locale, "route.pointPreviewExploration", { points: breakdown.exploration })}</span>
      )}
      {breakdown.diversity > 0 && (
        <span className="chip">{t(locale, "route.pointPreviewDiversity", { points: breakdown.diversity })}</span>
      )}
    </div>
  );
}

/** Modal shown after confirming a walk — mirrors Android completion AlertDialog. */
export function RouteCompletionDialog({
  locale,
  data,
  onClose,
}: {
  locale: Locale;
  data: RouteCompletionData;
  onClose: () => void;
}) {
  return (
    <div className="completion-overlay" role="dialog" aria-modal="true" aria-labelledby="completion-title">
      <div className="card completion-dialog">
        <h2 id="completion-title">{celebrationTitle(locale, data.celebrationTier)}</h2>
        <p className="completion-points">
          {t(locale, "route.completedPoints", {
            points: data.pointsEarned,
            multiplier: data.streakMultiplier,
            streak: data.currentStreak,
          })}
        </p>
        {data.pointBreakdown && <PointPreviewLines locale={locale} breakdown={data.pointBreakdown} />}
        {data.goldenHits !== undefined && data.goldenHits > 0 && (
          <p className="hint-compact">{t(locale, "route.completedGolden", { count: data.goldenHits })}</p>
        )}
        <div className="btn-row" style={{ marginTop: "0.65rem" }}>
          <button type="button" className="btn-primary btn-compact" onClick={onClose}>
            {t(locale, "common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
