import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes } from "@/lib/nodes";
import { getUserStats, getRecentWalks, getSegmentUsageStats, getStreakStats } from "@/lib/stats";
import { computeAchievements, TIERS } from "@/lib/achievements";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { deleteWalkAction } from "./actions";

function formatDate(iso: string, locale: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleString(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const TIER_COLORS: Record<string, string> = {
  stein: "#8a8a8a",
  blech: "#9fa8b0",
  bronze: "#a5711c",
  silber: "#b0b6bd",
  gold: "#c99a2e",
  platin: "#7fd3c9",
  diamant: "#5b9bd5",
};

function tierKey(tierIndex: number): string | null {
  return tierIndex >= 0 ? TIERS[tierIndex] : null;
}

export default async function StatsPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);

  const userStats = getUserStats(user.id);
  const streakStats = getStreakStats(user.id);
  const achievements = computeAchievements(user.id, locale);
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
          <span className="chip">
            {t(locale, "stats.currentStreak")}: {streakStats.currentStreak}
          </span>
          <span className="chip">
            {t(locale, "stats.longestStreak")}: {streakStats.longestStreak}
          </span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.8rem" }}>{t(locale, "achievements.title")}</h2>
        <div className="grid-2-cols">
          {achievements.scalable.map((a) => {
            const key = tierKey(a.tierIndex);
            return (
              <div key={a.category} style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
                <span
                  style={{
                    width: "0.9rem",
                    height: "0.9rem",
                    borderRadius: "50%",
                    background: key ? TIER_COLORS[key] : "var(--ink-soft)",
                    opacity: key ? 1 : 0.3,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <strong style={{ fontSize: "0.9rem" }}>
                    {a.categoryLabel} — {a.tierLabel ?? t(locale, "achievements.noTierYet")}
                  </strong>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" }}>{a.progressLabel}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="btn-row" style={{ marginTop: "0.4rem" }}>
          {achievements.special.map((s) => (
            <span key={s.id} className="chip" style={{ opacity: s.earned ? 1 : 0.4 }} title={s.description}>
              {s.earned ? "✓ " : "· "}
              {s.label}
            </span>
          ))}
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
                  <th></th>
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
                    <td>
                      <ConfirmSubmitForm
                        action={deleteWalkAction}
                        confirmMessage={t(locale, "stats.deleteWalkConfirm")}
                        hiddenName="walkId"
                        hiddenValue={w.id}
                        buttonLabel={t(locale, "map.delete")}
                      />
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
