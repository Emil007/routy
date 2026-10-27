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

  // §J2: In dieser Phase liegt die aktive Route noch im Plan-Sheet (Gehen kommt in J3).
  // Eine aktive Route schlägt das Query („included aktive Route“); Go wird erst in J3 geöffnet.
  let startMode: "explore" | "plan" | "go" | "record";
  const requested =
    mode === "explore" || mode === "plan" || mode === "go" || mode === "record" ? mode : null;
  if (bootstrap.activeRoute) {
    startMode = requested === "explore" || requested === "record" ? requested : "plan";
  } else {
    startMode = requested === "plan" ? "plan" : "explore";
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
