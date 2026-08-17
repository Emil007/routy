import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import Link from "next/link";
import { listNodes } from "@/lib/nodes";
import { listSegments, getUsageMap, isCanonicalSegment } from "@/lib/segments";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { MapPageClient } from "./MapPageClient";
import { renameNodeAction, setHomeNodeAction, deleteSegmentAction } from "./actions";

export default async function MapPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
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
        <h2 style={{ fontSize: "1.1rem" }}>{t(locale, "map.nodesHeading")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{t(locale, "map.nameHeading")}</th>
                <th>{t(locale, "map.home")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id}>
                  <td>{n.id}</td>
                  <td>
                    <form action={renameNodeAction} className="btn-row">
                      <input type="hidden" name="nodeId" value={n.id} />
                      <input type="text" name="name" defaultValue={n.name ?? ""} style={{ maxWidth: 200 }} />
                      <button type="submit" className="btn-secondary">
                        {t(locale, "map.rename")}
                      </button>
                    </form>
                  </td>
                  <td>{n.isHome ? "🏠" : ""}</td>
                  <td>
                    {!n.isHome && (
                      <form action={setHomeNodeAction}>
                        <input type="hidden" name="nodeId" value={n.id} />
                        <button type="submit" className="btn-secondary">
                          {t(locale, "map.home")}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
