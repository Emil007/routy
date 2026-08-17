import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes } from "@/lib/nodes";
import { getUserStats, getRecentWalks, getSegmentUsageStats } from "@/lib/stats";

function formatDate(iso: string, locale: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleString(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function StatsPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);

  const userStats = getUserStats(user.id);
  const recentWalks = getRecentWalks(user.id, 8);
  const usageStats = getSegmentUsageStats();
  const nodes = listNodes();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const mostUsed = [...usageStats].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);
  const leastUsed = [...usageStats].sort((a, b) => a.usageCount - b.usageCount).slice(0, 5);

  function nodeName(id: number): string {
    return nodesById.get(id)?.name || `#${id}`;
  }

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "stats.title")}</h1>
        <p>{t(locale, "stats.subtitle")}</p>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.8rem" }}>{t(locale, "stats.yourStats")}</h2>
        <div className="btn-row">
          <span className="chip">
            {t(locale, "stats.totalDistance")}: {(userStats.totalLengthM / 1000).toFixed(1)} {t(locale, "common.km")}
          </span>
          <span className="chip">
            {t(locale, "stats.totalWalks")}: {userStats.walkCount}
          </span>
          <span className="chip">
            {t(locale, "stats.totalTime")}: {Math.round(userStats.totalDurationMin / 60)} {t(locale, "common.hours")}
          </span>
          <span className="chip">
            {t(locale, "stats.segmentsExplored")}: {userStats.segmentsExplored} / {userStats.totalSegments}
          </span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.8rem" }}>{t(locale, "stats.recentWalks")}</h2>
        {recentWalks.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>{t(locale, "stats.noWalksYet")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "stats.date")}</th>
                  <th>{t(locale, "route.stationList")}</th>
                  <th>{t(locale, "import.length")}</th>
                  <th>{t(locale, "import.duration")}</th>
                </tr>
              </thead>
              <tbody>
                {recentWalks.map((w) => (
                  <tr key={w.id}>
                    <td>{formatDate(w.acceptedAt, locale)}</td>
                    <td>
                      {nodeName(w.nodeChain[0])} → {nodeName(w.nodeChain[w.nodeChain.length - 1])}
                    </td>
                    <td>
                      {(w.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
                    </td>
                    <td>
                      {w.durationMin} {t(locale, "common.min")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.8rem" }}>{t(locale, "stats.networkStats")}</h2>
        {usageStats.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>{t(locale, "stats.noSegments")}</p>
        ) : (
          <div className="grid-2-cols">
            <div>
              <strong style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "stats.mostUsed")}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {mostUsed.map((s) => (
                  <li key={s.segmentId} style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                    {nodeName(s.startNodeId)} — {nodeName(s.endNodeId)}{" "}
                    <span className="chip">{t(locale, "map.usageCount", { count: s.usageCount })}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "stats.leastUsed")}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {leastUsed.map((s) => (
                  <li key={s.segmentId} style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                    {nodeName(s.startNodeId)} — {nodeName(s.endNodeId)}{" "}
                    <span className="chip">{t(locale, "map.usageCount", { count: s.usageCount })}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
