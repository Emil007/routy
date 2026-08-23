"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import type { PointPreviewBreakdown } from "@/lib/points";

export interface CompletedRouteSnapshot {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
}

export interface RouteCompletionData {
  walkId: number;
  pointsEarned: number;
  streakMultiplier: number;
  currentStreak: number;
  pointBreakdown?: PointPreviewBreakdown;
  goldenHits?: number;
  celebrationTier?: string;
  route?: CompletedRouteSnapshot;
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

const LENGTH_RATINGS = [1, 2, 3, 4, 5] as const;
const LENGTH_RATING_KEYS = {
  1: "route.lengthRatingVeryShort",
  2: "route.lengthRatingShort",
  3: "route.lengthRatingNormal",
  4: "route.lengthRatingLong",
  5: "route.lengthRatingVeryLong",
} as const;

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
  const router = useRouter();
  const [selectedRating, setSelectedRating] = useState<(typeof LENGTH_RATINGS)[number] | null>(null);
  const [ratingStatus, setRatingStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteStatus, setFavoriteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submitRating(rating: (typeof LENGTH_RATINGS)[number]) {
    setSelectedRating(rating);
    setRatingStatus("saving");
    const res = await fetch("/api/app/walks/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkId: data.walkId, rating }),
    });
    if (res.ok) {
      setRatingStatus("saved");
    } else {
      setRatingStatus("error");
    }
  }

  async function saveFavorite() {
    if (!data.route) return;
    const name = favoriteName.trim();
    if (!name) return;
    setFavoriteStatus("saving");
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        nodeChain: data.route.nodeChain,
        segmentIds: data.route.segmentIds,
        lengthM: data.route.lengthM,
        durationMin: data.route.durationMin,
      }),
    });
    if (res.ok) {
      setFavoriteStatus("saved");
      router.refresh();
    } else {
      setFavoriteStatus("error");
    }
  }

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

        <p className="hint-compact completion-length-prompt" style={{ marginTop: "0.65rem", marginBottom: 0 }}>
          {t(locale, "route.lengthRatingTitle")}
        </p>
        <div className="length-rating-row length-rating-prominent" role="group" aria-label={t(locale, "route.lengthRatingTitle")}>
          {LENGTH_RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              className={`btn-secondary btn-compact${selectedRating === rating ? " selected" : ""}`}
              disabled={ratingStatus === "saving"}
              onClick={() => submitRating(rating)}
            >
              {t(locale, LENGTH_RATING_KEYS[rating])}
            </button>
          ))}
        </div>
        {ratingStatus === "saved" && (
          <p className="hint-compact" style={{ marginTop: "0.35rem" }}>{t(locale, "route.ratingSaved")}</p>
        )}
        {ratingStatus === "error" && (
          <p className="hint-compact" style={{ marginTop: "0.35rem", color: "var(--danger)" }}>
            {t(locale, "common.error")}
          </p>
        )}

        {data.route && (
          <div style={{ marginTop: "0.65rem" }}>
            <p className="hint-compact" style={{ marginBottom: "0.35rem" }}>{t(locale, "route.saveAsFavoritePrompt")}</p>
            <div className="btn-row" style={{ gap: "0.35rem" }}>
              <input
                type="text"
                value={favoriteName}
                onChange={(e) => setFavoriteName(e.target.value)}
                placeholder={t(locale, "route.routeNamePlaceholder")}
                style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", padding: "0.35rem 0.5rem" }}
              />
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={saveFavorite}
                disabled={favoriteStatus === "saving" || !favoriteName.trim()}
              >
                {favoriteStatus === "saved" ? t(locale, "route.favoriteSaved") : t(locale, "route.saveFavorite")}
              </button>
            </div>
            {favoriteStatus === "error" && (
              <p className="hint-compact" style={{ marginTop: "0.35rem", color: "var(--danger)" }}>
                {t(locale, "common.error")}
              </p>
            )}
          </div>
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
