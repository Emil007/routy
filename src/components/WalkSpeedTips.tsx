"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { TimedWalkSpeedTips } from "@/lib/trackGeometry";
import { saveWalkSpeedAction } from "@/app/(app)/settings/actions";

/** One-tap apply of GPS-derived average walk speeds. */
export function WalkSpeedTips({ locale, tips }: { locale: Locale; tips: TimedWalkSpeedTips }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  if (tips.timedCount === 0 || tips.avgAllKmh == null) {
    return <p className="hint">{t(locale, "settings.walkSpeedTipsEmpty")}</p>;
  }

  async function apply(kmh: number) {
    setStatus("saving");
    const fd = new FormData();
    fd.set("walkSpeedKmh", String(kmh));
    try {
      await saveWalkSpeedAction(fd);
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="stack" style={{ marginTop: "0.75rem", gap: "0.4rem" }}>
      <p className="hint-compact">{t(locale, "settings.walkSpeedTipsIntro", { count: tips.timedCount })}</p>
      <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
        <button
          type="button"
          className="btn-secondary btn-compact"
          disabled={status === "saving"}
          onClick={() => void apply(tips.avgAllKmh!)}
        >
          {t(locale, "settings.walkSpeedTipsApplyAll", { speed: tips.avgAllKmh })}
        </button>
        {tips.timedCount > 3 && tips.avgLast3Kmh != null && (
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={status === "saving"}
            onClick={() => void apply(tips.avgLast3Kmh!)}
          >
            {t(locale, "settings.walkSpeedTipsApplyLast3", { speed: tips.avgLast3Kmh })}
          </button>
        )}
      </div>
      {status === "error" && <div className="alert alert-error">{t(locale, "common.error")}</div>}
    </div>
  );
}
