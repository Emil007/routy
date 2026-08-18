import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { getSegment, listSegments, isCanonicalSegment } from "@/lib/segments";
import { getNode, listNodes } from "@/lib/nodes";
import { getSettings } from "@/lib/settings";
import { canEdit } from "@/lib/ownership";
import { EditSegmentWizard } from "@/components/EditSegmentWizard";

export default async function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);

  const segmentId = Number(id);
  const raw = Number.isNaN(segmentId) ? null : getSegment(segmentId);
  const canonical = raw ? (isCanonicalSegment(raw) ? raw : raw.reverseOf !== null ? getSegment(raw.reverseOf) : null) : null;
  if (!canonical) notFound();

  const startNode = getNode(canonical.startNodeId);
  const endNode = getNode(canonical.endNodeId);
  const networkLines = listSegments()
    .filter(isCanonicalSegment)
    .filter((s) => s.id !== canonical.id)
    .map((s) => ({ id: s.id, points: s.geometry.map((p): [number, number] => [p.lat, p.lng]) }));
  const nodes = listNodes();
  const settings = getSettings();

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "edit.title")}</h1>
        <p>{t(locale, "edit.subtitle")}</p>
      </div>
      <EditSegmentWizard
        locale={locale}
        segmentId={canonical.id}
        initialPoints={canonical.geometry}
        startNodeName={startNode?.name || `#${canonical.startNodeId}`}
        endNodeName={endNode?.name || `#${canonical.endNodeId}`}
        networkLines={networkLines}
        nodes={nodes}
        mergeRadiusM={settings.merge_radius_m}
        canEditSegment={canEdit(user, canonical.submittedBy)}
      />
    </>
  );
}
