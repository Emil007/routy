import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { getUser } from "@/lib/users";
import { updateUserAction, resetTotpAction } from "../actions";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireAdmin();
  const locale = await resolveLocale(admin.locale);
  const { id } = await params;
  const { error } = await searchParams;

  const userId = Number(id);
  const target = Number.isNaN(userId) ? null : getUser(userId);
  if (!target || target.deletedAt) notFound();

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "admin.editUserTitle", { name: target.displayName })}</h1>
      </div>

      {error === "taken" && <div className="alert alert-error">{t(locale, "profile.usernameTaken")}</div>}

      <div className="card">
        <form action={updateUserAction} className="stack">
          <input type="hidden" name="userId" value={target.id} />
          <div className="field">
            <label htmlFor="displayName">{t(locale, "profile.displayName")}</label>
            <input type="text" id="displayName" name="displayName" defaultValue={target.displayName} required />
          </div>
          <div className="field">
            <label htmlFor="username">{t(locale, "profile.username")}</label>
            <input type="text" id="username" name="username" defaultValue={target.username} autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="locale">{t(locale, "profile.locale")}</label>
            <select id="locale" name="locale" defaultValue={target.locale}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="newPassword">{t(locale, "admin.newPasswordLabel")}</label>
            <input type="password" id="newPassword" name="newPassword" autoComplete="new-password" minLength={6} placeholder={t(locale, "admin.newPasswordPlaceholder")} />
            <span className="hint">{t(locale, "admin.newPasswordHint")}</span>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn-primary btn-compact">
              {t(locale, "common.save")}
            </button>
            <Link href="/admin" className="btn-secondary btn-compact">
              {t(locale, "common.back")}
            </Link>
          </div>
        </form>
      </div>

      {target.totpEnabled && (
        <div className="card">
          <h2>{t(locale, "admin.resetTotpTitle")}</h2>
          <p className="hint-compact">{t(locale, "admin.resetTotpSubtitle")}</p>
          <form action={resetTotpAction}>
            <input type="hidden" name="userId" value={target.id} />
            <button type="submit" className="btn-secondary btn-compact">
              {t(locale, "admin.resetTotpButton")}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
