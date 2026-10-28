import type { AtlasBootstrap } from "@/lib/atlasTypes";
import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { listNodes, getUserHomeNode, listDeletedNodes } from "@/lib/nodes";
import { listSegments, isCanonicalSegment, listDeletedSegments, getUsageMap } from "@/lib/segments";
import { toCanonicalUsageMap } from "@/lib/points";
import { listAllUsers } from "@/lib/users";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { listActiveConditions } from "@/lib/segmentConditions";
import { listAvoidSegmentIds } from "@/lib/avoidList";
import { getTodayGoldenSegmentIds } from "@/lib/goldenSegments";
import { loadGraphContext } from "@/lib/routeContext";
import { disconnectedCanonicalSegmentIds } from "@/lib/graphReachability";
import { getActiveRoute } from "@/lib/activeRoute";
import { listFavorites } from "@/lib/favorites";
import { buildActiveRouteDisplay, buildRouteDisplay } from "@/lib/routeDisplay";
import { lengthBandForUser } from "@/lib/lengthTaste";

/**
 * Atlas bootstrap — Server-only Loader (§4.1). Vereint, was heute route/page.tsx und
 * map/page.tsx laden. Kein besser-sqlite3-Import in den Client; alle Daten sind serialisierbar.
 */
export async function loadAtlasBootstrap(opts: { requestedMode: string | null; deleteError?: string | null }): Promise<AtlasBootstrap> {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const nodes = listNodes();
  const segments = listSegments();
  const canonicalSegments = segments.filter(isCanonicalSegment);
  const canonicalSegmentIds = canonicalSegments.map((s) => s.id);
  const usage = getUsageMap(user.id);
  // M49 (F38): die ANZEIGE-Map faltet beide Richtungen auf die kanonische ID — wer
  // den Weg in Gegenrichtung gegangen ist, sieht auf Chip/Sortierung die gleiche Zahl.
  const canonicalOf = new Map(segments.map((s) => [s.id, s.reverseOf !== null ? Math.min(s.id, s.reverseOf) : s.id]));
  const displayUsage = toCanonicalUsageMap(usage, canonicalOf);
  const userNames = new Map(listAllUsers().map((u) => [u.id, u.displayName]));
  const settings = getSettings();
  const walkSpeedKmh = effectiveWalkSpeedKmh(user.walkSpeedKmh, settings);
  const { graph, segmentsById, nodesById } = loadGraphContext();

  const home = getUserHomeNode(user.id);
  const homeNodeId = home?.id ?? null;
  const segmentEndpoints = new Map(
    [...segmentsById.values()].map((s) => [s.id, { startNodeId: s.startNodeId, endNodeId: s.endNodeId }]),
  );
  const disconnectedSegmentIds = disconnectedCanonicalSegmentIds(
    graph,
    homeNodeId,
    canonicalSegmentIds,
    segmentEndpoints,
  );

  // Route / Planen
  const active = getActiveRoute(user.id);
  const activeRoute = active ? buildActiveRouteDisplay(active, nodesById, segmentsById) : null;
  const favorites = listFavorites(user.id).map((f) => ({
    id: f.id,
    name: f.name,
    shareToken: f.shareToken,
    display: buildRouteDisplay(f.nodeChain, f.segmentIds, f.lengthM, f.durationMin, nodesById, segmentsById),
  }));
  const segmentGeometries = Object.fromEntries(
    [...segmentsById.values()].map((s) => [s.id, s.geometry.map((p): [number, number] => [p.lat, p.lng])]),
  );
  const segmentNames = Object.fromEntries([...segmentsById.values()].map((s) => [s.id, s.name])) as Record<
    number,
    string | null
  >;
  const lengthBand = lengthBandForUser(user.id, "normal");

  const deletedNodes = listDeletedNodes()
    .filter((n) => user.role === "admin" || n.createdBy === user.id)
    .map((n) => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, deletedBy: n.createdBy, deletedAt: n.deletedAt }));
  const deletedSegments = listDeletedSegments()
    .filter(isCanonicalSegment)
    .filter((s) => user.role === "admin" || s.submittedBy === user.id)
    .map((s) => ({ id: s.id, name: s.name, submittedBy: s.submittedBy, deletedAt: s.deletedAt }));

  const requestedMode =
    opts.requestedMode === "explore" || opts.requestedMode === "plan" || opts.requestedMode === "go" || opts.requestedMode === "record"
      ? opts.requestedMode
      : null;

  return {
    locale,
    userId: user.id,
    role: user.role,
    displayName: user.displayName,
    theme: user.theme,
    homeNodeId,
    walkSpeedKmh,
    mergeRadiusM: settings.merge_radius_m,
    nodes,
    segments: canonicalSegments,
    canonicalSegmentIds,
    usage: Object.fromEntries(usage),
    // M49: Anzeige-Map (kanonisch gefaltet) separat — die gerichtete ‚usage‘ könnte
    // woanders noch gebraucht werden, die UI nutzt nur displayUsage.
    usageCanonical: Object.fromEntries(displayUsage),
    userNames: Object.fromEntries(userNames),
    segmentConditions: listActiveConditions().map((c) => ({
      id: c.id,
      segmentId: c.segmentId,
      reason: c.reason,
      expiresAt: c.expiresAt,
    })),
    personalAvoidSegmentIds: listAvoidSegmentIds(user.id),
    goldenSegmentIds: getTodayGoldenSegmentIds(),
    disconnectedSegmentIds,
    deleteError: opts.deleteError ?? null,
    activeRoute,
    activeNickname: active?.nickname ?? null,
    favorites,
    segmentGeometries,
    segmentNames,
    usingNetworkFallback: lengthBand.usingNetworkFallback,
    deletedNodes,
    deletedSegments,
    requestedMode,
  };
}
