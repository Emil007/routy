import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { createProfileAction } from "./actions";

export default async function NewProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const { error, success } = await searchParams;

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "profile.title")}</h1>
        <p>{t(locale, "profile.subtitle")}</p>
      </div>

      {success && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{t(locale, "profile.success")}</div>}
      {error === "taken" && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {t(locale, "profile.usernameTaken")}
        </div>
      )}
      {error === "invalid" && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {t(locale, "common.error")}
        </div>
      )}

      <div className="card">
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
      </div>
    </>
  );
}
