import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes } from "@/lib/nodes";
import { listSegments, isCanonicalSegment } from "@/lib/segments";
import { getSettings } from "@/lib/settings";
import { ImportModeSwitch } from "@/components/ImportModeSwitch";

export default async function ImportPage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const nodes = listNodes();
  const settings = getSettings();
  const networkLines = listSegments()
    .filter(isCanonicalSegment)
    .map((s) => ({ id: s.id, points: s.geometry.map((p): [number, number] => [p.lat, p.lng]) }));

  return (
    <>
      <div className="page-heading">
        <h1>{t(locale, "import.title")}</h1>
        <p>{t(locale, "import.subtitle")}</p>
      </div>
      <ImportModeSwitch
        locale={locale}
        nodes={nodes}
        networkLines={networkLines}
        mergeRadiusM={settings.merge_radius_m}
        walkSpeedKmh={settings.walk_speed_kmh}
      />
    </>
  );
}
