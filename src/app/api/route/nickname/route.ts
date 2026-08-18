import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getActiveRoute, setActiveRouteNickname } from "@/lib/activeRoute";

const bodySchema = z.object({ nickname: z.string().trim().max(120) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!getActiveRoute(user.id)) return NextResponse.json({ error: "no_active_route" }, { status: 404 });

  setActiveRouteNickname(user.id, parsed.data.nickname || null);
  return NextResponse.json({ ok: true });
}
