"use client";

import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { saveWalkSpeedAction } from "@/app/(app)/settings/actions";

export function WalkSpeedSaveForm({
  locale,
  defaultSpeed,
  networkDefault,
}: {
  locale: Locale;
  defaultSpeed: string;
  networkDefault: number;
}) {
  const [value, setValue] = useState(defaultSpeed);
  const [saved, setSaved] = useState(false);
  const dirty = value !== defaultSpeed;

  return (
    <form
      action={saveWalkSpeedAction}
      className="stack"
      onSubmit={() => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      }}
    >
      <div className="field">
        <label htmlFor="walkSpeedKmh">{t(locale, "settings.walk_speed_kmh")}</label>
        <input
          id="walkSpeedKmh"
          name="walkSpeedKmh"
          type="number"
          step="any"
          min={0}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder={String(networkDefault)}
        />
        <span className="hint">{t(locale, "settings.walkSpeedHint", { default: networkDefault })}</span>
      </div>
      <button type="submit" className="btn-secondary btn-compact" disabled={!dirty}>
        {t(locale, "common.save")}
      </button>
      {saved && !dirty ? <span className="hint">{t(locale, "settings.walkSpeedSaved")}</span> : null}
    </form>
  );
}
