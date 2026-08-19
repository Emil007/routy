import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes, listDeletedNodes } from "@/lib/nodes";
import { listSegments, listDeletedSegments, getUsageMap, isCanonicalSegment } from "@/lib/segments";
import { listAllUsers } from "@/lib/users";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { listActiveConditions } from "@/lib/segmentConditions";
import { OverviewMapClient } from "./OverviewMapClient";
import { SegmentsTable } from "./SegmentsTable";
import { TrashPanel } from "./TrashPanel";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ deleteError?: string }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const { deleteError } = await searchParams;
  const nodes = listNodes();
  const segments = listSegments();
  const usage = getUsageMap();
  const canonicalSegments = segments.filter(isCanonicalSegment);
  const userNames = new Map(listAllUsers().map((u) => [u.id, u.displayName]));
  const settings = getSettings();

  const deletedNodes = listDeletedNodes().filter((n) => user.role === "admin" || n.createdBy === user.id);
  const deletedSegments = listDeletedSegments()
    .filter(isCanonicalSegment)
    .filter((s) => user.role === "admin" || s.submittedBy === user.id);

  const segmentCounts: Record<number, number> = {};
  for (const s of canonicalSegments) {
    segmentCounts[s.startNodeId] = (segmentCounts[s.startNodeId] ?? 0) + 1;
    segmentCounts[s.endNodeId] = (segmentCounts[s.endNodeId] ?? 0) + 1;
  }

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "map.title")}</h1>
        <p>{t(locale, "map.subtitle")}</p>
      </div>

      {deleteError === "node_active" && <div className="alert alert-error">{t(locale, "map.deleteBlockedNode")}</div>}
      {deleteError === "segment_active" && <div className="alert alert-error">{t(locale, "map.deleteBlockedSegment")}</div>}
      {deleteError === "not_owner" && <div className="alert alert-error">{t(locale, "map.editBlockedNotOwner")}</div>}

      <OverviewMapClient
        locale={locale}
        nodes={nodes}
        segments={canonicalSegments}
        usage={Object.fromEntries(usage)}
        segmentCounts={segmentCounts}
        currentUser={{ id: user.id, role: user.role }}
        userNames={Object.fromEntries(userNames)}
        mergeRadiusM={settings.merge_radius_m}
        walkSpeedKmh={effectiveWalkSpeedKmh(user.walkSpeedKmh, settings)}
        segmentConditions={listActiveConditions().map((c) => ({
          id: c.id,
          segmentId: c.segmentId,
          reason: c.reason,
          expiresAt: c.expiresAt,
        }))}
      />

      <details className="card">
        <summary style={{ fontSize: "1.1rem", fontWeight: 600, cursor: "pointer" }}>{t(locale, "map.segmentsHeading")}</summary>
        <SegmentsTable
          locale={locale}
          segments={canonicalSegments}
          nodes={nodes}
          usage={Object.fromEntries(usage)}
          userNames={Object.fromEntries(userNames)}
          currentUser={{ id: user.id, role: user.role }}
        />
      </details>

      <TrashPanel locale={locale} deletedNodes={deletedNodes} deletedSegments={deletedSegments} />
    </>
  );
}
