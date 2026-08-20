import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes, getHomeNode } from "@/lib/nodes";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { loadGraphContext } from "@/lib/routeContext";
import { buildRouteDisplay } from "@/lib/routeDisplay";
import { RouteGenerator } from "@/components/RouteGenerator";

export default async function RoutePage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const nodes = listNodes();
  const home = getHomeNode();

  const { segmentsById, nodesById } = loadGraphContext();

  const active = getActiveRoute(user.id);
  const activeDisplay = active
    ? buildRouteDisplay(active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, nodesById, segmentsById)
    : null;

  const favorites = listFavorites(user.id).map((f) => ({
    id: f.id,
    name: f.name,
    shareToken: f.shareToken,
    display: buildRouteDisplay(f.nodeChain, f.segmentIds, f.lengthM, f.durationMin, nodesById, segmentsById),
  }));

  const segmentGeometries = Object.fromEntries(
    [...segmentsById.values()].map((s) => [
      s.id,
      s.geometry.map((p): [number, number] => [p.lat, p.lng]),
    ]),
  );

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "route.title")}</h1>
      </div>
      {nodes.length === 0 ? (
        <div className="card">
          <p>{t(locale, "import.noTracks")}</p>
        </div>
      ) : (
        <RouteGenerator
          locale={locale}
          nodes={nodes}
          homeNodeId={home?.id ?? null}
          initialActiveRoute={activeDisplay}
          initialNickname={active?.nickname ?? null}
          favorites={favorites}
          segmentGeometries={segmentGeometries}
        />
      )}
    </>
  );
}
