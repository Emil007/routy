import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSettings, type Settings } from "@/lib/settings";
import { getUser } from "@/lib/users";
import { totpQrCodeDataUrl } from "@/lib/twoFactor";
import { LocaleSelectForm } from "@/components/LocaleSelectForm";
import { ThemeSelectForm } from "@/components/ThemeSelectForm";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import {
  saveSettingsAction,
  saveWalkSpeedAction,
  changePasswordAction,
  logoutEverywhereAction,
  deleteOwnAccountAction,
  startEnableTotpAction,
  confirmEnableTotpAction,
  cancelEnableTotpAction,
  disableTotpAction,
} from "./actions";

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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    passwordError?: string;
    passwordSuccess?: string;
    loggedOutEverywhere?: string;
    totpSetup?: string;
    totpError?: string;
    totpEnabled?: string;
    totpDisabled?: string;
    totpDisableError?: string;
  }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const settings = getSettings();
  const { passwordError, passwordSuccess, loggedOutEverywhere, totpSetup, totpError, totpEnabled, totpDisabled, totpDisableError } =
    await searchParams;

  const pendingTotp = totpSetup === "1" ? getUser(user.id) : null;
  const totpQrCode = pendingTotp?.totpSecret ? await totpQrCodeDataUrl(pendingTotp.totpSecret, user.username) : null;

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

          <div>
            <h3>{t(locale, "settings.changePasswordTitle")}</h3>
            {passwordSuccess && <div className="alert alert-success">{t(locale, "settings.passwordChanged")}</div>}
            {passwordError && <div className="alert alert-error">{t(locale, "settings.passwordChangeError")}</div>}
            <form action={changePasswordAction} className="stack">
              <div className="field">
                <label htmlFor="currentPassword">{t(locale, "settings.currentPassword")}</label>
                <input type="password" id="currentPassword" name="currentPassword" autoComplete="current-password" required />
              </div>
              <div className="field">
                <label htmlFor="newPassword">{t(locale, "settings.newPassword")}</label>
                <input type="password" id="newPassword" name="newPassword" autoComplete="new-password" minLength={6} required />
              </div>
              <button type="submit" className="btn-secondary btn-compact">
                {t(locale, "common.save")}
              </button>
            </form>
          </div>

          <div>
            <h3>{t(locale, "settings.totpTitle")}</h3>
            <p className="hint-compact">{t(locale, "settings.totpSubtitle")}</p>
            {pendingTotp?.totpSecret && totpQrCode ? (
              <>
                {totpError === "1" && (
                  <div className="alert alert-error">{t(locale, "settings.totpConfirmError")}</div>
                )}
                <p>{t(locale, "settings.totpScanHint")}</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered data: URL, no optimization needed */}
                <img src={totpQrCode} alt="" width={160} height={160} className="totp-qr" />
                <p className="hint" style={{ wordBreak: "break-all" }}>
                  {t(locale, "settings.totpManualKey")}: {pendingTotp.totpSecret}
                </p>
                <form action={confirmEnableTotpAction} id="confirmTotpForm" className="stack">
                  <div className="field">
                    <label htmlFor="totpCode">{t(locale, "login.totpCodeLabel")}</label>
                    <input type="text" id="totpCode" name="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
                  </div>
                </form>
                <div className="btn-row">
                  <button type="submit" form="confirmTotpForm" className="btn-primary btn-compact">
                    {t(locale, "settings.totpConfirmButton")}
                  </button>
                  <form action={cancelEnableTotpAction}>
                    <button type="submit" className="btn-secondary btn-compact">
                      {t(locale, "common.cancel")}
                    </button>
                  </form>
                </div>
              </>
            ) : user.totpEnabled ? (
              <>
                {totpEnabled === "1" && (
                  <div className="alert alert-success">{t(locale, "settings.totpEnabledMessage")}</div>
                )}
                {totpDisableError === "1" && (
                  <div className="alert alert-error">{t(locale, "settings.totpDisableError")}</div>
                )}
                <p>{t(locale, "settings.totpEnabledStatus")}</p>
                <form action={disableTotpAction} className="stack">
                  <div className="field">
                    <label htmlFor="totpCurrentPassword">{t(locale, "settings.currentPassword")}</label>
                    <input type="password" id="totpCurrentPassword" name="currentPassword" autoComplete="current-password" required />
                  </div>
                  <button type="submit" className="btn-secondary btn-compact">
                    {t(locale, "settings.totpDisableButton")}
                  </button>
                </form>
              </>
            ) : (
              <>
                {totpDisabled === "1" && (
                  <div className="alert alert-success">{t(locale, "settings.totpDisabledMessage")}</div>
                )}
                <form action={startEnableTotpAction}>
                  <button type="submit" className="btn-secondary btn-compact">
                    {t(locale, "settings.totpEnableButton")}
                  </button>
                </form>
              </>
            )}
          </div>

          <div>
            <h3>{t(locale, "settings.logoutEverywhereTitle")}</h3>
            <p className="hint-compact">{t(locale, "settings.logoutEverywhereSubtitle")}</p>
            {loggedOutEverywhere && (
              <div className="alert alert-success">{t(locale, "settings.loggedOutEverywhere")}</div>
            )}
            <form action={logoutEverywhereAction}>
              <button type="submit" className="btn-secondary btn-compact">
                {t(locale, "settings.logoutEverywhereButton")}
              </button>
            </form>
          </div>

          {user.role !== "admin" && (
            <div>
              <h3>{t(locale, "settings.deleteAccountTitle")}</h3>
              <p className="hint-compact">{t(locale, "settings.deleteAccountSubtitle")}</p>
              <ConfirmSubmitForm
                action={deleteOwnAccountAction}
                confirmMessage={t(locale, "settings.deleteAccountConfirm")}
                hiddenName="confirm"
                hiddenValue="1"
                buttonLabel={t(locale, "settings.deleteAccountButton")}
              />
            </div>
          )}
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
