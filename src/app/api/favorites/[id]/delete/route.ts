import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { deleteFavorite } from "@/lib/favorites";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const favoriteId = Number(id);
  if (!Number.isInteger(favoriteId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const ok = deleteFavorite(favoriteId, user.id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
