import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getAdminInsights } from "@/lib/adminInsights";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default async function AdminInsightsPage() {
  const admin = await requireAdmin();
  const locale = await resolveLocale(admin.locale);
  const insights = getAdminInsights();

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "admin.insightsHeading")}</h1>
        <p>{t(locale, "admin.insightsSubtitle")}</p>
        <p>
          <Link href="/admin">{t(locale, "admin.activityBackToUsers")}</Link>
          {" · "}
          <Link href="/admin/activity">{t(locale, "admin.activityHeading")}</Link>
        </p>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">{t(locale, "admin.insightsWalksThisWeek")}</th>
                <td>{insights.walksThisWeek}</td>
              </tr>
              <tr>
                <th scope="row">{t(locale, "admin.insightsWalksLast7Days")}</th>
                <td>{insights.walksLast7Days}</td>
              </tr>
              <tr>
                <th scope="row">{t(locale, "admin.insightsGoldenHitRate")}</th>
                <td>
                  {pct(insights.goldenHitRateLast7Days)}
                  <span className="hint-compact">
                    {" "}
                    ({insights.goldenHitWalksLast7Days}/{insights.walksLast7Days})
                  </span>
                </td>
              </tr>
              <tr>
                <th scope="row">{t(locale, "admin.insightsPendingLocks")}</th>
                <td>{insights.pendingLockProposals}</td>
              </tr>
              <tr>
                <th scope="row">{t(locale, "admin.insightsSegmentCoverage")}</th>
                <td>
                  {insights.segmentsWalked}/{insights.totalCanonicalSegments}
                  {insights.totalCanonicalSegments > 0
                    ? ` (${pct(insights.segmentsWalked / insights.totalCanonicalSegments)})`
                    : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{t(locale, "admin.insightsTopWalkers")}</h2>
        {insights.topWalkers.length === 0 ? (
          <p className="hint-compact">{t(locale, "admin.insightsTopWalkersEmpty")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t(locale, "profile.displayName")}</th>
                  <th>{t(locale, "stats.points")}</th>
                </tr>
              </thead>
              <tbody>
                {insights.topWalkers.map((w, i) => (
                  <tr key={w.userId}>
                    <td>{i + 1}</td>
                    <td>{w.displayName}</td>
                    <td>{w.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
