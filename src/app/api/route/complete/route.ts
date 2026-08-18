import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute, clearActiveRoute } from "@/lib/activeRoute";
import { recordWalk } from "@/lib/segments";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = getActiveRoute(user.id);
  if (!active) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  recordWalk(user.id, active.nodeChain, active.segmentIds, active.lengthM, active.durationMin, active.nickname);
  clearActiveRoute(user.id);

  return NextResponse.json({ success: true });
}
