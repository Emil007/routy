/**
 * Runs once when the server process starts (Next.js instrumentation hook).
 * Used for one-time background migrations that shouldn't need a manual UI
 * button — e.g. backfilling elevation for paths saved before that feature
 * existed. Fire-and-forget: never blocks server startup or requests.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { db } = await import("./lib/db");
  const { backfillMissingElevation } = await import("./lib/segments");

  const MARKER_KEY = "elevation_backfill_done";
  const already = db.prepare("SELECT value FROM settings WHERE key = ?").get(MARKER_KEY);
  if (already) return;

  backfillMissingElevation()
    .catch(() => {
      // Best-effort — a failed/partial run (e.g. no outbound internet) still
      // marks done so it doesn't retry forever; the elevation data is only
      // ever a nice-to-have, and any newly submitted paths get it up front.
    })
    .finally(() => {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(MARKER_KEY, "1");
    });
}
