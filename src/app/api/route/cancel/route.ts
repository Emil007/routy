import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { deleteRouteSession, assertRouteSessionOwner } from "@/lib/routeSessions";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const access = assertRouteSessionOwner(parsed.data.token, user.id);
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  deleteRouteSession(parsed.data.token);
  return NextResponse.json({ success: true });
}
