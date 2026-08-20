import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { getUserStats, getStreakStats, getRecentWalks, getSegmentUsageStats } from "@/lib/stats";
import { computeAchievements } from "@/lib/achievements";
import { computeUserPoints } from "@/lib/points";
import { listNodes } from "@/lib/nodes";

/** Native stats tab payload — mirrors the Stats page's computed data. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = await resolveLocale(user.locale);

  return NextResponse.json({
    stats: getUserStats(user.id),
    streak: getStreakStats(user.id),
    achievements: computeAchievements(user.id, locale),
    recentWalks: getRecentWalks(user.id, 8),
    points: computeUserPoints(user.id),
    networkUsage: getSegmentUsageStats(),
    nodes: listNodes().map((n) => ({ id: n.id, name: n.name })),
  });
}
