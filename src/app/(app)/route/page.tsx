import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes, getUserHomeNode } from "@/lib/nodes";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { listSegments, isCanonicalSegment } from "@/lib/segments";
import { loadGraphContext } from "@/lib/routeContext";
import { buildActiveRouteDisplay, buildRouteDisplay } from "@/lib/routeDisplay";
import { lengthBandForUser } from "@/lib/lengthTaste";
import { disconnectedCanonicalSegmentIds } from "@/lib/graphReachability";
import { RouteGenerator } from "@/components/RouteGenerator";

export default async function RoutePage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const nodes = listNodes();
  const home = getUserHomeNode(user.id);

  const { graph, segmentsById, nodesById } = loadGraphContext();

  const active = getActiveRoute(user.id);
  const activeDisplay = active ? buildActiveRouteDisplay(active, nodesById, segmentsById) : null;

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

  const canonicalSegmentIds = listSegments().filter(isCanonicalSegment).map((s) => s.id);

  const segmentNames = Object.fromEntries(
    [...segmentsById.values()].map((s) => [s.id, s.name]),
  ) as Record<number, string | null>;

  const lengthBand = lengthBandForUser(user.id, "normal");
  const segmentEndpoints = new Map(
    [...segmentsById.values()].map((s) => [s.id, { startNodeId: s.startNodeId, endNodeId: s.endNodeId }]),
  );
  const disconnectedSegmentIds = disconnectedCanonicalSegmentIds(
    graph,
    home?.id ?? null,
    canonicalSegmentIds,
    segmentEndpoints,
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
          canonicalSegmentIds={canonicalSegmentIds}
          segmentNames={segmentNames}
          initialUsingNetworkFallback={lengthBand.usingNetworkFallback}
          disconnectedSegmentIds={disconnectedSegmentIds}
          isAdmin={user.role === "admin"}
        />
      )}
    </>
  );
}
