import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getFavoriteByShareToken } from "@/lib/favorites";
import { getSegment } from "@/lib/segments";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { MapViewLazy } from "@/components/MapViewLazy";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await resolveLocale(undefined);
  const favorite = getFavoriteByShareToken(token);

  if (!favorite) {
    return (
      <main className="container">
        <div className="page-heading">
          <h1>{t(locale, "share.notFoundTitle")}</h1>
        </div>
        <div className="card">
          <p>{t(locale, "share.notFoundBody")}</p>
        </div>
      </main>
    );
  }

  // The network may have changed since this route was favorited — same staleness
  // check as accepting a favorite normally. getSegment still returns a soft-deleted
  // row, so check deletedAt explicitly rather than just null.
  const stale = favorite.segmentIds.some((segId) => {
    const segment = getSegment(segId);
    return !segment || segment.deletedAt !== null;
  });

  const { nodesById, segmentsById } = loadGraphContext();
  const display = stale
    ? null
    : buildRouteDisplay(favorite.nodeChain, favorite.segmentIds, favorite.lengthM, favorite.durationMin, nodesById, segmentsById);

  return (
    <main className="container">
      <div className="page-heading">
        <h1>{favorite.name}</h1>
        <p>{t(locale, "share.subtitle")}</p>
      </div>

      {!display ? (
        <div className="card">
          <p>{t(locale, "route.favoriteStale")}</p>
        </div>
      ) : (
        <div className="card stack">
          <MapViewLazy
            lines={[{ id: "route", points: display.geometry }]}
            markers={display.stations.map((s, idx) => ({
              id: `${s.nodeId}-${idx}`,
              lat: s.lat,
              lng: s.lng,
              label: s.name || `#${s.nodeId}`,
              color: idx === 0 ? "#a5711c" : "#2e6b49",
            }))}
            height={360}
          />

          <div className="btn-row">
            <span className="chip">
              {t(locale, "route.distanceLabel")}: {(display.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
            </span>
            <span className="chip">
              {t(locale, "route.durationLabel")}: {display.durationMin} {t(locale, "common.min")}
            </span>
            {display.elevation && (
              <>
                <span className="chip">↗ {t(locale, "route.elevationGain", { gain: display.elevation.gainM })}</span>
                <span className="chip">↘ {t(locale, "route.elevationLoss", { loss: display.elevation.lossM })}</span>
              </>
            )}
          </div>

          <div>
            <strong style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "route.stationList")}</strong>
            <p style={{ marginTop: "0.3rem" }}>
              {display.shortStationGroups
                .map((g) => (g.viaSegmentName ? `${g.text} (${t(locale, "route.via", { name: g.viaSegmentName })})` : g.text))
                .join(" › ")}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
