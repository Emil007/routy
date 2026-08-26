import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { ensureTodayGoldenSegments } from "@/lib/goldenSegments";
import { listSegments } from "@/lib/segments";
import { listNodes } from "@/lib/nodes";
import { computeUserPoints } from "@/lib/points";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = await resolveLocale(user.locale);
  const golden = ensureTodayGoldenSegments(user.id);
  const segmentsById = new Map(listSegments().map((s) => [s.id, s]));
  const nodesById = new Map(listNodes().map((n) => [n.id, n]));
  const points = computeUserPoints(user.id);

  return NextResponse.json({
    goldenSegments: golden.map((g) => {
      const seg = segmentsById.get(g.segmentId);
      const start = seg ? nodesById.get(seg.startNodeId)?.name || `#${seg.startNodeId}` : null;
      const end = seg ? nodesById.get(seg.endNodeId)?.name || `#${seg.endNodeId}` : null;
      const name = seg?.name || (start && end ? `${start} — ${end}` : null);
      return {
        segmentId: g.segmentId,
        multiplier: g.multiplier,
        name,
      };
    }),
    dailyChallenge: t(locale, "game.dailyChallenge"),
    pointBalance: points.totalPoints,
    streakMultiplier: points.streakMultiplier,
  });
}
