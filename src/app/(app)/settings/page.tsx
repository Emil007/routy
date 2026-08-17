import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSettings, SETTINGS_KEYS, type Settings } from "@/lib/settings";
import { saveSettingsAction } from "./actions";

const STEP: Partial<Record<keyof Settings, number>> = {
  daily_diversity_weight: 0.5,
  walk_speed_kmh: 0.5,
};

export default async function SettingsPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const settings = getSettings();

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "settings.title")}</h1>
        <p>{t(locale, "settings.subtitle")}</p>
      </div>

      <div className="card">
        <form action={saveSettingsAction} className="stack">
          {SETTINGS_KEYS.map((key) => (
            <div className="field" key={key}>
              <label htmlFor={key}>{t(locale, `settings.${key}`)}</label>
              <input
                id={key}
                name={key}
                type="number"
                step={STEP[key] ?? 1}
                min={0}
                defaultValue={settings[key]}
              />
              <span className="hint">{t(locale, `settings.${key}_hint`)}</span>
            </div>
          ))}
          <button type="submit" className="btn-primary">
            {t(locale, "common.save")}
          </button>
        </form>
      </div>
    </>
  );
}
