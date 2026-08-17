import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getRouteSession, deleteRouteSession } from "@/lib/routeSessions";
import { setActiveRoute } from "@/lib/activeRoute";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const session = getRouteSession(parsed.data.token);
  if (!session) return NextResponse.json({ error: "session_expired" }, { status: 410 });

  // Accepting doesn't record the walk yet — it becomes this profile's active
  // route (persisted, visible on any device that profile signs in on) until
  // explicitly confirmed as walked or discarded.
  setActiveRoute(user.id, {
    nodeChain: session.current.nodeChain,
    segmentIds: session.current.segmentIds,
    lengthM: session.current.lengthM,
    durationMin: session.current.durationMin,
  });
  deleteRouteSession(parsed.data.token);

  return NextResponse.json({ success: true });
}
