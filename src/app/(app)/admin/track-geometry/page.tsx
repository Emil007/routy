import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { TrackGeometryReview } from "@/components/TrackGeometryReview";

export default async function TrackGeometryAdminPage() {
  const admin = await requireAdmin();
  const locale = await resolveLocale(admin.locale);

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "admin.trackGeometryHeading")}</h1>
        <p>{t(locale, "admin.trackGeometrySubtitle")}</p>
        <p>
          <Link href="/admin">{t(locale, "admin.activityBackToUsers")}</Link>
        </p>
      </div>
      <TrackGeometryReview locale={locale} />
    </>
  );
}
