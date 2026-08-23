"use client";

import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";

function goldenCountForNetwork(canonicalCount: number, percent: number): number {
  if (canonicalCount <= 0) return 0;
  const clamped = Math.min(25, Math.max(1, percent));
  return Math.max(1, Math.round((canonicalCount * clamped) / 100));
}

/** Admin stepper for daily golden share — live (picked/total), 1% steps, clamp 1–25. */
export function GoldenPercentStepper({
  locale,
  initialPercent,
  canonicalTotal,
}: {
  locale: Locale;
  initialPercent: number;
  canonicalTotal: number;
}) {
  const [percent, setPercent] = useState(initialPercent);
  const picked = goldenCountForNetwork(canonicalTotal, percent);

  function step(delta: number) {
    setPercent((p) => Math.min(25, Math.max(1, p + delta)));
  }

  return (
    <div className="field">
      <label htmlFor="golden_percent">{t(locale, "settings.golden_percent")}</label>
      <div className="btn-row" style={{ alignItems: "center", gap: "0.5rem" }}>
        <button type="button" className="btn-secondary btn-compact" onClick={() => step(-1)} disabled={percent <= 1} aria-label="-1%">
          −
        </button>
        <span style={{ minWidth: "3rem", textAlign: "center", fontWeight: 600 }}>{percent}%</span>
        <button type="button" className="btn-secondary btn-compact" onClick={() => step(1)} disabled={percent >= 25} aria-label="+1%">
          +
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {t(locale, "settings.golden_percent_preview", { picked, total: canonicalTotal })}
        </span>
      </div>
      <input type="hidden" id="golden_percent" name="golden_percent" value={percent} />
      <span className="hint">{t(locale, "settings.golden_percent_hint")}</span>
    </div>
  );
}
