import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t, type Locale } from "@/lib/i18n";
import { listActivity } from "@/lib/activityLog";

function normalizeServerIso(iso: string): string {
  const normalized = iso.trim().replace(" ", "T");
  if (normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized)) return normalized;
  return `${normalized}Z`;
}

function formatActivityWhen(iso: string, locale: Locale): string {
  return new Date(normalizeServerIso(iso)).toLocaleString(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function activityActionLabel(locale: Locale, action: string): string {
  return t(locale, `admin.activityActions.${action}`);
}

function activityEntityLabel(locale: Locale, entityType: string): string {
  const label = t(locale, `admin.activityEntities.${entityType}`);
  return label.startsWith("admin.activityEntities.") ? entityType : label;
}

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
                  <td>{formatActivityWhen(e.createdAt, locale)}</td>
                  <td>{e.userDisplayName ?? "—"}</td>
                  <td>{activityActionLabel(locale, e.action)}</td>
                  <td>
                    {activityEntityLabel(locale, e.entityType)}
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
