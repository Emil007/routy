import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { loadAtlasBootstrap } from "@/lib/mapBootstrap";
import { MapShell } from "@/components/map-shell/MapShell";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; deleteError?: string }>;
}) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const { mode, deleteError } = await searchParams;

  const bootstrap = await loadAtlasBootstrap({ requestedMode: mode ?? null, deleteError: deleteError ?? null });

  // §J3: Aktive Route → Gehen (Startmodus go). Sonst: Query plan/go/explore/record
  // wie gewünscht, Default explore. Read-only-Modus aus einer aktiven Route überlebt
  // nur explore/record (Karte ansehen), planen/gehen schlagen auf die aktive Route auf.
  let startMode: "explore" | "plan" | "go" | "record";
  const requested =
    mode === "explore" || mode === "plan" || mode === "go" || mode === "record" ? mode : null;
  if (bootstrap.activeRoute) {
    startMode = requested === "record" || requested === "explore" ? requested : "go";
  } else {
    startMode = requested === "plan" || requested === "go" ? requested : "explore";
  }

  return (
    <MapShell
      locale={locale}
      bootstrap={bootstrap}
      embedded={user.client === "app"}
      initialMode={startMode}
    />
  );
}
