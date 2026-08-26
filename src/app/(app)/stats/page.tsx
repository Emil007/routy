import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes } from "@/lib/nodes";
import { listSegments } from "@/lib/segments";
import { walkPathPoints } from "@/lib/walkPathPoints";
import { getUserStats, getRecentWalks, getSegmentUsageStats, getStreakStats, getWeeklyLeaderboard } from "@/lib/stats";
import { computeUserPoints, getPointsLeaderboard } from "@/lib/points";
import { ensureTodayGoldenSegments } from "@/lib/goldenSegments";
import { computeAchievements, TIERS } from "@/lib/achievements";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { WalkPathThumbnail } from "@/components/WalkPathThumbnail";
import { deleteWalkAction } from "./actions";

function normalizeServerIso(iso: string): string {
  const normalized = iso.trim().replace(" ", "T");
  if (normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized)) return normalized;
  return `${normalized}Z`;
}

function formatDate(iso: string, locale: string): string {
  return new Date(normalizeServerIso(iso)).toLocaleString(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDurationHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
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
  const usageStats = getSegmentUsageStats(user.id);
  const leaderboard = getWeeklyLeaderboard();
  const userPoints = computeUserPoints(user.id);
  const pointsLeaderboard = getPointsLeaderboard();
  const goldenToday = ensureTodayGoldenSegments(user.id);
  const nodes = listNodes();
  const segments = listSegments();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const walkCoords = new Map(nodes.map((n) => [n.id, { lat: n.lat, lng: n.lng }]));
  const segmentGeometry = new Map(segments.map((s) => [s.id, s.geometry]));

  const mostUsed = [...usageStats].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);
  const leastUsed = [...usageStats].sort((a, b) => a.usageCount - b.usageCount).slice(0, 5);

  function nodeName(id: number): string {
    return nodesById.get(id)?.name || `#${id}`;
  }

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "stats.title")}</h1>
        <p>{t(locale, "game.hubSubtitle")}</p>
      </div>

      <div className="card">
        <h2>{t(locale, "stats.gameHubTitle")}</h2>
        <p style={{ fontSize: "2rem", fontWeight: 700, margin: "0.25rem 0 0.5rem" }}>
          {userPoints.totalPoints}
        </p>
        <p className="hint-compact" style={{ marginTop: 0 }}>{t(locale, "stats.gameHubBalance")}</p>
        <div className="btn-row" style={{ marginTop: "0.5rem" }}>
          <span className="chip">
            {t(locale, "stats.weeklyPoints")}: {userPoints.weeklyPoints}
          </span>
          <span className="chip">
            {t(locale, "route.streakMultiplier", { multiplier: userPoints.streakMultiplier })}
          </span>
          <span className="chip">
            {t(locale, "stats.currentStreak")}: {streakStats.currentStreak}
          </span>
        </div>
        <p className="hint-compact" style={{ marginTop: "0.65rem" }}>{t(locale, "game.dailyChallenge")}</p>
        <h3 style={{ marginTop: "0.75rem", marginBottom: "0.35rem" }}>{t(locale, "stats.gameHubGolden")}</h3>
        {goldenToday.length === 0 ? (
          <p className="hint-compact">{t(locale, "game.goldenEmpty")}</p>
        ) : (
          <ul className="dense-list">
            {goldenToday.map((g) => {
              const seg = segments.find((s) => s.id === g.segmentId);
              const start = seg ? nodeName(seg.startNodeId) : `#${g.segmentId}`;
              const end = seg ? nodeName(seg.endNodeId) : "";
              return (
                <li key={g.segmentId}>
                  {seg?.name || `${start} — ${end}`}{" "}
                  <span className="chip">{t(locale, "game.goldenMultiplier", { multiplier: g.multiplier })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>{t(locale, "stats.yourStats")}</h2>
        <div className="btn-row">
          <span className="chip">
            {t(locale, "stats.totalDistance")}: {(userStats.totalLengthM / 1000).toFixed(1)} {t(locale, "common.km")}
          </span>
          <span className="chip">
            {t(locale, "stats.totalWalks")}: {userStats.walkCount}
          </span>
          <span className="chip">
            {t(locale, "stats.totalTime")}: {formatDurationHours(userStats.totalDurationMin)} {t(locale, "common.hours")}
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
          <span className="chip">
            {t(locale, "stats.points")}: {userPoints.totalPoints}
          </span>
          <span className="chip">
            {t(locale, "stats.weeklyPoints")}: {userPoints.weeklyPoints}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>{t(locale, "stats.pointsLeaderboardHeading")}</h2>
        {pointsLeaderboard.length === 0 ? (
          <p className="hint-compact">{t(locale, "stats.pointsLeaderboardEmpty")}</p>
        ) : (
          <ol className="dense-list">
            {pointsLeaderboard.map((entry) => (
              <li key={entry.userId} style={{ fontWeight: entry.userId === user.id ? 700 : 400 }}>
                {entry.displayName} — {entry.totalPoints} {t(locale, "achievements.units.points")}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2>{t(locale, "stats.leaderboardHeading")}</h2>
        {leaderboard.length === 0 ? (
          <p className="hint-compact">{t(locale, "stats.leaderboardEmpty")}</p>
        ) : (
          <ol className="dense-list">
            {leaderboard.map((entry) => (
              <li key={entry.userId} style={{ fontWeight: entry.userId === user.id ? 700 : 400 }}>
                {entry.displayName} — {(entry.totalLengthM / 1000).toFixed(1)} {t(locale, "common.km")}{" "}
                <span className="chip">{t(locale, "stats.totalWalks")}: {entry.walkCount}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2>{t(locale, "achievements.title")}</h2>
        <div className="grid-2-cols">
          {achievements.scalable.map((a) => {
            const key = tierKey(a.tierIndex);
            return (
              <div key={a.category} className="achievement-row">
                <span
                  className="achievement-tier-dot"
                  style={{
                    background: key ? TIER_COLORS[key] : "var(--ink-soft)",
                    opacity: key ? 1 : 0.3,
                  }}
                />
                <div>
                  <strong>
                    {a.categoryLabel} — {a.tierLabel ?? t(locale, "achievements.noTierYet")}
                  </strong>
                  <p>{a.progressLabel}</p>
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
        <h2>{t(locale, "stats.recentWalks")}</h2>
        {recentWalks.length === 0 ? (
          <p className="hint-compact">{t(locale, "stats.noWalksYet")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "stats.date")}</th>
                  <th></th>
                  <th>{t(locale, "route.stationList")}</th>
                  <th>{t(locale, "import.length")}</th>
                  <th>{t(locale, "import.duration")}</th>
                  <th>{t(locale, "stats.walkPoints")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentWalks.map((w) => (
                  <tr key={w.id}>
                    <td>{formatDate(w.acceptedAt, locale)}</td>
                    <td>
                      <WalkPathThumbnail
                        points={walkPathPoints(w.segmentIds, segmentGeometry, {
                          nodeChain: w.nodeChain,
                          coords: walkCoords,
                        })}
                      />
                    </td>
                    <td>
                      {w.nickname ? (
                        <>
                          <strong>{w.nickname}</strong>{" "}
                          <span style={{ color: "var(--ink-faint)" }}>
                            ({nodeName(w.nodeChain[0])} → {nodeName(w.nodeChain[w.nodeChain.length - 1])})
                          </span>
                        </>
                      ) : (
                        <>
                          {nodeName(w.nodeChain[0])} → {nodeName(w.nodeChain[w.nodeChain.length - 1])}
                        </>
                      )}
                    </td>
                    <td>
                      {(w.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
                    </td>
                    <td>
                      {w.durationMin} {t(locale, "common.min")}
                    </td>
                    <td>
                      {w.pointsEarned != null ? (
                        <span
                          className="chip"
                          title={[
                            w.pointsBase != null ? t(locale, "route.pointPreviewBase", { points: w.pointsBase }) : "",
                            w.pointsGolden ? t(locale, "route.pointPreviewGolden", { points: w.pointsGolden }) : "",
                            w.pointsExploration
                              ? t(locale, "route.pointPreviewExploration", { points: w.pointsExploration })
                              : "",
                            w.pointsDiversity
                              ? t(locale, "route.pointPreviewDiversity", { points: w.pointsDiversity })
                              : "",
                            w.streakMultiplier != null
                              ? t(locale, "route.streakMultiplier", { multiplier: w.streakMultiplier })
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        >
                          +{w.pointsEarned}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="btn-row" style={{ gap: "0.35rem", flexWrap: "nowrap" }}>
                        {w.hasTrack && (
                          <a
                            className="btn-secondary btn-compact"
                            href={`/api/app/stats/walks/gpx?walkId=${w.id}`}
                            download
                          >
                            {t(locale, "stats.exportGpx")}
                          </a>
                        )}
                        <ConfirmSubmitForm
                          action={deleteWalkAction}
                          confirmMessage={t(locale, "stats.deleteWalkConfirm")}
                          hiddenName="walkId"
                          hiddenValue={w.id}
                          buttonLabel={t(locale, "map.delete")}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t(locale, "stats.networkStats")}</h2>
        {usageStats.length === 0 ? (
          <p className="hint-compact">{t(locale, "stats.noSegments")}</p>
        ) : (
          <div className="grid-2-cols">
            <div>
              <strong className="hint-compact">{t(locale, "stats.mostUsed")}</strong>
              <ul className="dense-list">
                {mostUsed.map((s) => (
                  <li key={s.segmentId}>
                    {nodeName(s.startNodeId)} — {nodeName(s.endNodeId)}{" "}
                    <span className="chip">{t(locale, "map.usageCount", { count: s.usageCount })}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong className="hint-compact">{t(locale, "stats.leastUsed")}</strong>
              <ul className="dense-list">
                {leastUsed.map((s) => (
                  <li key={s.segmentId}>
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
