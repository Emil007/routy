import { redirect } from "next/navigation";
import { getCurrentUser, userCount } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { getCaptchaConfig } from "@/lib/captcha";
import { CaptchaWidget } from "@/components/CaptchaWidget";
import { loginAction, setupFirstProfileAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setupError?: string; retry?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/route");

  const locale = await resolveLocale(null);
  const { error, setupError, retry } = await searchParams;
  const needsSetup = userCount() === 0;
  const captcha = getCaptchaConfig();

  function setupErrorMessage(): string | null {
    if (!setupError) return null;
    if (setupError === "token") return t(locale, "login.setupTokenError");
    if (setupError === "captcha") return t(locale, "login.captchaError");
    if (setupError === "locked") return t(locale, "login.lockedError", { seconds: retry ?? "?" });
    return t(locale, "login.error");
  }

  function loginErrorMessage(): string | null {
    if (!error) return null;
    if (error === "inactive") return t(locale, "login.inactiveError");
    if (error === "locked") return t(locale, "login.lockedError", { seconds: retry ?? "?" });
    if (error === "captcha") return t(locale, "login.captchaError");
    return t(locale, "login.error");
  }

  return (
    <div className="container-narrow">
      <div className="page-heading">
        <h1>🐾 {t(locale, "common.appName")}</h1>
        <p>{needsSetup ? t(locale, "login.setupSubtitle") : t(locale, "login.subtitle")}</p>
      </div>

      <div className="card">
        {needsSetup ? (
          <>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>{t(locale, "login.setupTitle")}</h2>
            {setupErrorMessage() && (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{setupErrorMessage()}</div>
            )}
            <form action={setupFirstProfileAction} className="stack">
              <div className="field">
                <label htmlFor="setupToken">{t(locale, "login.setupTokenLabel")}</label>
                <input type="text" id="setupToken" name="setupToken" autoComplete="off" required />
                <span className="hint">{t(locale, "login.setupTokenHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="displayName">{t(locale, "profile.displayName")}</label>
                <input type="text" id="displayName" name="displayName" required />
              </div>
              <div className="field">
                <label htmlFor="username">{t(locale, "profile.username")}</label>
                <input type="text" id="username" name="username" autoComplete="username" required />
              </div>
              <div className="field">
                <label htmlFor="password">{t(locale, "profile.password")}</label>
                <input type="password" id="password" name="password" autoComplete="new-password" minLength={6} required />
              </div>
              <div className="field">
                <label htmlFor="locale">{t(locale, "profile.locale")}</label>
                <select id="locale" name="locale" defaultValue={locale}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>
              <CaptchaWidget config={captcha} />
              <button type="submit" className="btn-primary">
                {t(locale, "profile.submit")}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>{t(locale, "login.title")}</h2>
            {loginErrorMessage() && (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{loginErrorMessage()}</div>
            )}
            <form action={loginAction} className="stack">
              <div className="field">
                <label htmlFor="username">{t(locale, "login.username")}</label>
                <input type="text" id="username" name="username" autoComplete="username" required />
              </div>
              <div className="field">
                <label htmlFor="password">{t(locale, "login.password")}</label>
                <input type="password" id="password" name="password" autoComplete="current-password" required />
              </div>
              <CaptchaWidget config={captcha} />
              <button type="submit" className="btn-primary">
                {t(locale, "login.submit")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
