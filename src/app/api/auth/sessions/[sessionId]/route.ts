import { NextResponse } from "next/server";
import { getCurrentUser, revokeSessionById } from "@/lib/session";

/** Revoke one device/session by its id — e.g. "lost my phone", kick it from Settings. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const ok = revokeSessionById(user.id, sessionId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
