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
  const totpQrCode = pendingTotp?.totpSecret
    ? await totpQrCodeDataUrl(pendingTotp.totpSecret, user.username)
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
          pendingTotpSecret={pendingTotp?.totpSecret ?? null}
          totpQrCode={totpQrCode}
          flags={flags}
        />
      </div>
    </>
  );
}
