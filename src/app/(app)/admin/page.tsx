import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { listAllUsers } from "@/lib/users";
import { AdminUserActionsMenu } from "@/components/AdminUserActionsMenu";
import { AdminBackupButton } from "@/components/AdminBackupButton";
import { UpdateBanner } from "@/components/UpdateBanner";
import { checkForUpdate, isUpdateAvailable } from "@/lib/updateCheck";
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
  const update = await checkForUpdate();

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
        <p>
          <Link href="/admin/activity">{t(locale, "admin.activityHeading")}</Link>
          {" · "}
          <Link href="/admin/insights">{t(locale, "admin.insightsHeading")}</Link>
          {" · "}
          <Link href="/admin/track-geometry">{t(locale, "admin.trackGeometryHeading")}</Link>
        </p>
      </div>

      {update && isUpdateAvailable(update.latestVersion) && (
        <UpdateBanner
          latestVersion={update.latestVersion}
          url={update.url}
          message={t(locale, "admin.updateAvailable")}
          dismissLabel={t(locale, "admin.updateDismiss")}
        />
      )}

      {edited && <div className="alert alert-success">{t(locale, "admin.userUpdated")}</div>}
      {error === "taken" && <div className="alert alert-error">{t(locale, "profile.usernameTaken")}</div>}
      {error === "invalid" && <div className="alert alert-error">{t(locale, "common.error")}</div>}

      <div className="card">
        <h2>{t(locale, "admin.usersHeading")}</h2>
        <div className="table-wrap users-table">
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
                    {!u.deletedAt && (
                      <AdminUserActionsMenu
                        userId={u.id}
                        isSelf={u.id === admin.id}
                        isActive={u.active}
                        labels={{
                          edit: t(locale, "map.edit"),
                          lock: t(locale, "admin.lock"),
                          unlock: t(locale, "admin.unlock"),
                          impersonate: t(locale, "admin.impersonate"),
                          delete: t(locale, "map.delete"),
                          deleteConfirm: t(locale, "admin.deleteConfirm"),
                          menu: t(locale, "admin.actionsMenu"),
                        }}
                        toggleActiveAction={toggleActiveAction}
                        impersonateAction={impersonateAction}
                        deleteUserAction={deleteUserAction}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{t(locale, "admin.createUserHeading")}</h2>
        <form action={createUserAction} className="stack">
          <div className="field">
            <label htmlFor="displayName">{t(locale, "profile.displayName")}</label>
            <input type="text" id="displayName" name="displayName" required />
          </div>
          <div className="field">
            <label htmlFor="username">{t(locale, "profile.username")}</label>
            <input type="text" id="username" name="username" autoComplete="off" required />
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
          <button type="submit" className="btn-primary btn-compact">
            {t(locale, "profile.submit")}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>{t(locale, "admin.backupHeading")}</h2>
        <p>{t(locale, "admin.backupDesc")}</p>
        <AdminBackupButton label={t(locale, "admin.backupButton")} />
      </div>
    </>
  );
}
