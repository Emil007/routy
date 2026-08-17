import { redirect } from "next/navigation";
import { getCurrentUser, userCount } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { loginAction, setupFirstProfileAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setupError?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/route");

  const locale = await resolveLocale(null);
  const { error, setupError } = await searchParams;
  const needsSetup = userCount() === 0;

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
            {setupError && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{t(locale, "login.error")}</div>}
            <form action={setupFirstProfileAction} className="stack">
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
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
              <button type="submit" className="btn-primary">
                {t(locale, "profile.submit")}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>{t(locale, "login.title")}</h2>
            {error && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{t(locale, "login.error")}</div>}
            <form action={loginAction} className="stack">
              <div className="field">
                <label htmlFor="username">{t(locale, "login.username")}</label>
                <input type="text" id="username" name="username" autoComplete="username" required />
              </div>
              <div className="field">
                <label htmlFor="password">{t(locale, "login.password")}</label>
                <input type="password" id="password" name="password" autoComplete="current-password" required />
              </div>
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
