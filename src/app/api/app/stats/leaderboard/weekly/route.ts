import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getWeeklyLeaderboard } from "@/lib/stats";

/** Weekly household leaderboard for the native stats tab. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    userId: user.id,
    leaderboard: getWeeklyLeaderboard(),
  });
}
