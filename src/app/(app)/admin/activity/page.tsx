import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listActivity } from "@/lib/activityLog";

export default async function AdminActivityPage() {
  const admin = await requireAdmin();
  const locale = await resolveLocale(admin.locale);
  const entries = listActivity();

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "admin.activityHeading")}</h1>
        <p>
          <Link href="/admin">{t(locale, "admin.activityBackToUsers")}</Link>
        </p>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(locale, "admin.activityWhen")}</th>
                <th>{t(locale, "admin.activityWho")}</th>
                <th>{t(locale, "admin.activityAction")}</th>
                <th>{t(locale, "admin.activityEntity")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.createdAt}</td>
                  <td>{e.userDisplayName ?? "—"}</td>
                  <td>{e.action}</td>
                  <td>
                    {e.entityType}
                    {e.entityId !== null ? ` #${e.entityId}` : ""}
                    {e.details?.name ? ` — ${String(e.details.name)}` : ""}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4}>{t(locale, "admin.activityEmpty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
