import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";

/**
 * The web recording wizard (RecordTrackWizard.tsx) gets merge_radius_m and the effective walk
 * speed as RSC props from src/app/(app)/map/page.tsx — no REST equivalent existed since the web
 * app never needed one. The native recording screen needs both: merge_radius_m for the same
 * client-side candidate-junction matching (src/lib/nodeMatching.ts, ported to
 * logic/recording/NodeMatching.kt), and walkSpeedKmh as the duration-estimate fallback when GPS
 * timestamps aren't trustworthy.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const settings = getSettings();
  return NextResponse.json({
    mergeRadiusM: settings.merge_radius_m,
    walkSpeedKmh: effectiveWalkSpeedKmh(user.walkSpeedKmh, settings),
  });
}
