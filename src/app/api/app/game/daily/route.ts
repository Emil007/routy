import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { ensureTodayGoldenSegments } from "@/lib/goldenSegments";
import { listSegments } from "@/lib/segments";
import { computeUserPoints } from "@/lib/points";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = await resolveLocale(user.locale);
  const golden = ensureTodayGoldenSegments();
  const segmentsById = new Map(listSegments().map((s) => [s.id, s]));
  const points = computeUserPoints(user.id);

  return NextResponse.json({
    goldenSegments: golden.map((g) => ({
      segmentId: g.segmentId,
      multiplier: g.multiplier,
      name: segmentsById.get(g.segmentId)?.name ?? null,
    })),
    dailyChallenge: t(locale, "game.dailyChallenge"),
    pointBalance: points.totalPoints,
    streakMultiplier: points.streakMultiplier,
  });
}
