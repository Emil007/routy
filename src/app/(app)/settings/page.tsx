import Link from "next/link";
import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSettings, type Settings } from "@/lib/settings";
import { LocaleSelectForm } from "@/components/LocaleSelectForm";
import { ThemeSelectForm } from "@/components/ThemeSelectForm";
import { GoldenPercentStepper } from "@/components/GoldenPercentStepper";
import { saveSettingsAction, saveWalkSpeedAction } from "./actions";
import { previewGoldenPick } from "@/lib/goldenSegments";

const STEP: Partial<Record<keyof Settings, number>> = {
  daily_diversity_weight: 0.5,
  walk_speed_kmh: 0.5,
  suggest_min_km: 0.5,
  suggest_max_km: 0.5,
  adjust_step_percent: 5,
};

const NETWORK_GROUPS: (keyof Settings)[][] = [
  ["merge_radius_m", "name_far_warn_m", "tolerance_percent"],
  ["widen_step_percent", "widen_max_percent", "adjust_step_percent"],
  ["daily_diversity_weight", "walk_speed_kmh"],
  ["suggest_min_km", "suggest_max_km"],
];

function NetworkField({
  fieldKey,
  settings,
  locale,
}: {
  fieldKey: keyof Settings;
  settings: Settings;
  locale: "de" | "en";
}) {
  return (
    <div className="field" key={fieldKey}>
      <label htmlFor={fieldKey}>{t(locale, `settings.${fieldKey}`)}</label>
      <input
        id={fieldKey}
        name={fieldKey}
        type="number"
        step={STEP[fieldKey] ?? 1}
        min={0}
        defaultValue={settings[fieldKey]}
      />
      <span className="hint">{t(locale, `settings.${fieldKey}_hint`)}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const settings = getSettings();
  const goldenPreview = previewGoldenPick(settings.golden_percent);

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "settings.title")}</h1>
        <p>{t(locale, "settings.subtitle")}</p>
      </div>

      <div className="card">
        <h2>{t(locale, "settings.languageTitle")}</h2>
        <LocaleSelectForm currentLocale={locale} />
      </div>

      <div className="card">
        <h2>{t(locale, "settings.themeTitle")}</h2>
        <ThemeSelectForm currentTheme={user.theme} locale={locale} />
      </div>

      <div className="card">
        <h2>{t(locale, "settings.walkSpeedTitle")}</h2>
        <p className="hint-compact">{t(locale, "settings.walkSpeedSubtitle")}</p>
        <form action={saveWalkSpeedAction} className="stack">
          <div className="field">
            <label htmlFor="walkSpeedKmh">{t(locale, "settings.walk_speed_kmh")}</label>
            <input
              id="walkSpeedKmh"
              name="walkSpeedKmh"
              type="number"
              step={0.5}
              min={0}
              defaultValue={user.walkSpeedKmh ?? ""}
              placeholder={String(settings.walk_speed_kmh)}
            />
            <span className="hint">{t(locale, "settings.walkSpeedHint", { default: settings.walk_speed_kmh })}</span>
          </div>
          <button type="submit" className="btn-secondary btn-compact">
            {t(locale, "common.save")}
          </button>
        </form>
      </div>

      <details id="account" className="card settings-collapsible">
        <summary>{t(locale, "settings.accountSecurityTitle")}</summary>
        <div className="settings-collapsible-body stack">
          <p className="hint-compact">{t(locale, "settings.accountSecuritySubtitle")}</p>
          <Link href="/settings/account" className="btn-secondary btn-compact">
            {t(locale, "settings.accountSecurityOpen")}
          </Link>
        </div>
      </details>

      {user.role === "admin" && (
        <details className="card settings-collapsible">
          <summary>{t(locale, "settings.networkTitle")}</summary>
          <div className="settings-collapsible-body">
            <p className="hint-compact">{t(locale, "settings.networkSubtitle")}</p>
            <form action={saveSettingsAction} className="stack">
              {NETWORK_GROUPS.map((group, i) => (
                <div className="settings-network-grid" key={i}>
                  {group.map((key) => (
                    <NetworkField key={key} fieldKey={key} settings={settings} locale={locale} />
                  ))}
                </div>
              ))}
              <GoldenPercentStepper
                locale={locale}
                initialPercent={settings.golden_percent}
                canonicalTotal={goldenPreview.total}
              />
              <button type="submit" className="btn-primary btn-compact">
                {t(locale, "common.save")}
              </button>
            </form>
          </div>
        </details>
      )}
    </>
  );
}
