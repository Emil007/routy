import { t, type Locale } from "@/lib/i18n";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { SessionsPanel } from "@/components/SessionsPanel";
import {
  changePasswordAction,
  logoutEverywhereAction,
  deleteOwnAccountAction,
  startEnableTotpAction,
  confirmEnableTotpAction,
  cancelEnableTotpAction,
  disableTotpAction,
} from "@/app/(app)/settings/actions";

export function AccountSecurityPanel({
  locale,
  user,
  pendingTotpSecret,
  totpQrCode,
  flags,
}: {
  locale: Locale;
  user: { id: number; role: "admin" | "user"; totpEnabled: boolean };
  pendingTotpSecret: string | null;
  totpQrCode: string | null;
  flags: {
    passwordError?: string;
    passwordSuccess?: string;
    loggedOutEverywhere?: string;
    totpError?: string;
    totpEnabled?: string;
    totpDisabled?: string;
    totpDisableError?: string;
  };
}) {
  const {
    passwordError,
    passwordSuccess,
    loggedOutEverywhere,
    totpError,
    totpEnabled,
    totpDisabled,
    totpDisableError,
  } = flags;

  return (
    <div className="stack">
      <div>
        <h2>{t(locale, "settings.changePasswordTitle")}</h2>
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
        <h2>{t(locale, "settings.totpTitle")}</h2>
        <p className="hint-compact">{t(locale, "settings.totpSubtitle")}</p>
        {pendingTotpSecret && totpQrCode ? (
          <>
            {totpError === "1" && <div className="alert alert-error">{t(locale, "settings.totpConfirmError")}</div>}
            <p>{t(locale, "settings.totpScanHint")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered data: URL */}
            <img src={totpQrCode} alt="" width={160} height={160} className="totp-qr" />
            <p className="hint" style={{ wordBreak: "break-all" }}>
              {t(locale, "settings.totpManualKey")}: {pendingTotpSecret}
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
            {totpEnabled === "1" && <div className="alert alert-success">{t(locale, "settings.totpEnabledMessage")}</div>}
            {totpDisableError === "1" && <div className="alert alert-error">{t(locale, "settings.totpDisableError")}</div>}
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
            {totpDisabled === "1" && <div className="alert alert-success">{t(locale, "settings.totpDisabledMessage")}</div>}
            <form action={startEnableTotpAction}>
              <button type="submit" className="btn-secondary btn-compact">
                {t(locale, "settings.totpEnableButton")}
              </button>
            </form>
          </>
        )}
      </div>

      <SessionsPanel locale={locale} />

      <div>
        <h2>{t(locale, "settings.logoutEverywhereTitle")}</h2>
        <p className="hint-compact">{t(locale, "settings.logoutEverywhereSubtitle")}</p>
        {loggedOutEverywhere && <div className="alert alert-success">{t(locale, "settings.loggedOutEverywhere")}</div>}
        <form action={logoutEverywhereAction}>
          <button type="submit" className="btn-secondary btn-compact">
            {t(locale, "settings.logoutEverywhereButton")}
          </button>
        </form>
      </div>

      {user.role !== "admin" && (
        <div>
          <h2>{t(locale, "settings.deleteAccountTitle")}</h2>
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
  );
}
