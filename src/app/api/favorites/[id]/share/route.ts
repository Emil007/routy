import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { enableSharing, disableSharing } from "@/lib/favorites";

const bodySchema = z.object({ enable: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const favoriteId = Number(id);
  if (!Number.isInteger(favoriteId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!parsed.data.enable) {
    disableSharing(favoriteId, user.id);
    return NextResponse.json({ ok: true, shareToken: null });
  }

  const shareToken = enableSharing(favoriteId, user.id);
  if (!shareToken) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, shareToken });
}
