import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { listNodes, getHomeNode } from "@/lib/nodes";
import { RouteGenerator } from "@/components/RouteGenerator";

export default async function RoutePage() {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const nodes = listNodes();
  const home = getHomeNode();

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
        <RouteGenerator locale={locale} nodes={nodes} homeNodeId={home?.id ?? null} />
      )}
    </>
  );
}
