import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import Link from "next/link";
import { listNodes } from "@/lib/nodes";
import { listSegments, getUsageMap, isCanonicalSegment } from "@/lib/segments";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { MapPageClient } from "./MapPageClient";
import { deleteSegmentAction } from "./actions";

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
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const canonicalSegments = segments.filter(isCanonicalSegment);

  const segmentCounts = new Map<number, number>();
  for (const s of canonicalSegments) {
    segmentCounts.set(s.startNodeId, (segmentCounts.get(s.startNodeId) ?? 0) + 1);
    segmentCounts.set(s.endNodeId, (segmentCounts.get(s.endNodeId) ?? 0) + 1);
  }

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "map.title")}</h1>
        <p>{t(locale, "map.subtitle")}</p>
      </div>

      {deleteError === "node_active" && <div className="alert alert-error">{t(locale, "map.deleteBlockedNode")}</div>}
      {deleteError === "segment_active" && <div className="alert alert-error">{t(locale, "map.deleteBlockedSegment")}</div>}

      <MapPageClient
        locale={locale}
        nodes={nodes}
        lines={canonicalSegments.map((s) => ({
          id: s.id,
          points: s.geometry.map((p): [number, number] => [p.lat, p.lng]),
        }))}
        segmentCounts={segmentCounts}
      />

      <div className="card">
        <h2 style={{ fontSize: "1.1rem" }}>{t(locale, "map.segmentsHeading")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(locale, "route.start")}</th>
                <th>{t(locale, "route.destination")}</th>
                <th>{t(locale, "import.length")}</th>
                <th>{t(locale, "import.duration")}</th>
                <th>{t(locale, "route.elevationLabel")}</th>
                <th>{t(locale, "map.usageHeading")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {canonicalSegments.map((s) => (
                <tr key={s.id}>
                  <td>{nodesById.get(s.startNodeId)?.name || `#${s.startNodeId}`}</td>
                  <td>{nodesById.get(s.endNodeId)?.name || `#${s.endNodeId}`}</td>
                  <td>{(s.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}</td>
                  <td>{s.durationMin} {t(locale, "common.min")}</td>
                  <td>
                    {s.elevation
                      ? `↗${s.elevation.gainM} ↘${s.elevation.lossM} m`
                      : "–"}
                  </td>
                  <td>{t(locale, "map.usageCount", { count: usage.get(s.id) ?? 0 })}</td>
                  <td>
                    <div className="btn-row">
                      <Link href={`/map/edit/${s.id}`} className="btn-secondary">
                        {t(locale, "map.edit")}
                      </Link>
                      <ConfirmSubmitForm
                        action={deleteSegmentAction}
                        confirmMessage={t(locale, "map.deleteConfirm")}
                        hiddenName="segmentId"
                        hiddenValue={s.id}
                        buttonLabel={t(locale, "map.delete")}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
