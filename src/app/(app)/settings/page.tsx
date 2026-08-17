import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSettings, SETTINGS_KEYS, type Settings } from "@/lib/settings";
import { BackfillElevationButton } from "@/components/BackfillElevationButton";
import { saveSettingsAction, saveWalkSpeedAction, createProfileAction } from "./actions";

const STEP: Partial<Record<keyof Settings, number>> = {
  daily_diversity_weight: 0.5,
  walk_speed_kmh: 0.5,
  suggest_min_km: 0.5,
  suggest_max_km: 0.5,
  adjust_step_percent: 5,
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profileError?: string; profileSuccess?: string }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const settings = getSettings();
  const { profileError, profileSuccess } = await searchParams;

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

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.walkSpeedTitle")}</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {t(locale, "settings.walkSpeedSubtitle")}
        </p>
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
          <button type="submit" className="btn-secondary">
            {t(locale, "common.save")}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.elevationTitle")}</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {t(locale, "settings.elevationSubtitle")}
        </p>
        <BackfillElevationButton locale={locale} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "profile.title")}</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {t(locale, "profile.subtitle")}
        </p>

        {profileSuccess && (
          <div className="alert alert-success" style={{ marginBottom: "1rem" }}>
            {t(locale, "profile.success")}
          </div>
        )}
        {profileError === "taken" && (
          <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
            {t(locale, "profile.usernameTaken")}
          </div>
        )}
        {profileError === "invalid" && (
          <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
            {t(locale, "common.error")}
          </div>
        )}

        <form action={createProfileAction} className="stack">
          <div className="field">
            <label htmlFor="displayName">{t(locale, "profile.displayName")}</label>
            <input type="text" id="displayName" name="displayName" required />
          </div>
          <div className="field">
            <label htmlFor="username">{t(locale, "profile.username")}</label>
            <input type="text" id="username" name="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">{t(locale, "profile.password")}</label>
            <input type="password" id="password" name="password" minLength={6} required />
          </div>
          <div className="field">
            <label htmlFor="profileLocale">{t(locale, "profile.locale")}</label>
            <select id="profileLocale" name="locale" defaultValue={locale}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            {t(locale, "profile.submit")}
          </button>
        </form>
      </div>
    </>
  );
}
