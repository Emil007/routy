import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getUser } from "@/lib/users";
import { totpQrCodeDataUrl } from "@/lib/twoFactor";
import { AccountSecurityPanel } from "@/components/AccountSecurityPanel";

/** Focused account page for the Android WebView sheet — password / 2FA / sessions only. */
export default async function SettingsAccountPage({
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
  const flags = await searchParams;
  const pendingTotp = flags.totpSetup === "1" ? getUser(user.id) : null;
  // M2-1/F07: the setup QR always comes from the PENDING secret, never the live
  // one — and only while 2FA is still off (a cancelled setup must not regress it).
  const pendingSecret =
    !pendingTotp?.totpEnabled && pendingTotp?.totpPendingSecret ? pendingTotp.totpPendingSecret : null;
  const totpQrCode = pendingSecret
    ? await totpQrCodeDataUrl(pendingSecret, user.username)
    : null;

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "settings.accountSecurityTitle")}</h1>
        <p>{t(locale, "settings.accountSecuritySubtitle")}</p>
      </div>
      <div className="card">
        <AccountSecurityPanel
          locale={locale}
          user={{ id: user.id, role: user.role, totpEnabled: user.totpEnabled }}
          pendingTotpSecret={pendingSecret}
          totpQrCode={totpQrCode}
          flags={flags}
        />
      </div>
    </>
  );
}
