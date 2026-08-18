import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { listAllUsers } from "@/lib/users";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { createUserAction, toggleActiveAction, deleteUserAction, impersonateAction } from "./actions";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edited?: string }>;
}) {
  const admin = await requireAdmin();
  const locale = await resolveLocale(admin.locale);
  const { error, edited } = await searchParams;
  const users = listAllUsers();

  function statusLabel(u: (typeof users)[number]): string {
    if (u.deletedAt) return t(locale, "admin.statusDeleted");
    if (!u.active) return t(locale, "admin.statusLocked");
    return t(locale, "admin.statusActive");
  }

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "admin.title")}</h1>
        <p>{t(locale, "admin.subtitle")}</p>
      </div>

      {edited && <div className="alert alert-success">{t(locale, "admin.userUpdated")}</div>}
      {error === "taken" && <div className="alert alert-error">{t(locale, "profile.usernameTaken")}</div>}
      {error === "invalid" && <div className="alert alert-error">{t(locale, "common.error")}</div>}

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.8rem" }}>{t(locale, "admin.usersHeading")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(locale, "profile.displayName")}</th>
                <th>{t(locale, "profile.username")}</th>
                <th>{t(locale, "admin.roleHeading")}</th>
                <th>{t(locale, "admin.statusHeading")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.deletedAt ? "—" : u.username}</td>
                  <td>{u.role === "admin" ? t(locale, "admin.roleAdmin") : t(locale, "admin.roleUser")}</td>
                  <td>{statusLabel(u)}</td>
                  <td>
                    <div className="btn-row">
                      {!u.deletedAt && (
                        <>
                          <Link href={`/admin/${u.id}`} className="btn-secondary">
                            {t(locale, "map.edit")}
                          </Link>
                          {u.id !== admin.id && (
                            <>
                              <form action={toggleActiveAction}>
                                <input type="hidden" name="userId" value={u.id} />
                                <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                                <button type="submit" className="btn-secondary">
                                  {u.active ? t(locale, "admin.lock") : t(locale, "admin.unlock")}
                                </button>
                              </form>
                              <form action={impersonateAction}>
                                <input type="hidden" name="userId" value={u.id} />
                                <button type="submit" className="btn-secondary">
                                  {t(locale, "admin.impersonate")}
                                </button>
                              </form>
                              <ConfirmSubmitForm
                                action={deleteUserAction}
                                confirmMessage={t(locale, "admin.deleteConfirm")}
                                hiddenName="userId"
                                hiddenValue={u.id}
                                buttonLabel={t(locale, "map.delete")}
                              />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.3rem" }}>{t(locale, "admin.createUserHeading")}</h2>
        <form action={createUserAction} className="stack">
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
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
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
