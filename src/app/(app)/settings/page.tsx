import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSettings, SETTINGS_KEYS, type Settings } from "@/lib/settings";
import { LocaleSelectForm } from "@/components/LocaleSelectForm";
import { ThemeSelectForm } from "@/components/ThemeSelectForm";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import {
  saveSettingsAction,
  saveWalkSpeedAction,
  changePasswordAction,
  logoutEverywhereAction,
  deleteOwnAccountAction,
} from "./actions";

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
  searchParams: Promise<{ passwordError?: string; passwordSuccess?: string; loggedOutEverywhere?: string }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const settings = getSettings();
  const { passwordError, passwordSuccess, loggedOutEverywhere } = await searchParams;

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "settings.title")}</h1>
        <p>{t(locale, "settings.subtitle")}</p>
      </div>

      {user.role === "admin" && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.networkTitle")}</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            {t(locale, "settings.networkSubtitle")}
          </p>
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
      )}

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
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.languageTitle")}</h2>
        <LocaleSelectForm currentLocale={locale} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.themeTitle")}</h2>
        <ThemeSelectForm currentTheme={user.theme} locale={locale} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.changePasswordTitle")}</h2>
        {passwordSuccess && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{t(locale, "settings.passwordChanged")}</div>}
        {passwordError && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{t(locale, "settings.passwordChangeError")}</div>}
        <form action={changePasswordAction} className="stack">
          <div className="field">
            <label htmlFor="currentPassword">{t(locale, "settings.currentPassword")}</label>
            <input type="password" id="currentPassword" name="currentPassword" autoComplete="current-password" required />
          </div>
          <div className="field">
            <label htmlFor="newPassword">{t(locale, "settings.newPassword")}</label>
            <input type="password" id="newPassword" name="newPassword" autoComplete="new-password" minLength={6} required />
          </div>
          <button type="submit" className="btn-secondary">
            {t(locale, "common.save")}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.logoutEverywhereTitle")}</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {t(locale, "settings.logoutEverywhereSubtitle")}
        </p>
        {loggedOutEverywhere && (
          <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{t(locale, "settings.loggedOutEverywhere")}</div>
        )}
        <form action={logoutEverywhereAction}>
          <button type="submit" className="btn-secondary">
            {t(locale, "settings.logoutEverywhereButton")}
          </button>
        </form>
      </div>

      {user.role !== "admin" && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "settings.deleteAccountTitle")}</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            {t(locale, "settings.deleteAccountSubtitle")}
          </p>
          <ConfirmSubmitForm
            action={deleteOwnAccountAction}
            confirmMessage={t(locale, "settings.deleteAccountConfirm")}
            hiddenName="confirm"
            hiddenValue="1"
            buttonLabel={t(locale, "settings.deleteAccountButton")}
          />
        </div>
      )}
    </>
  );
}
