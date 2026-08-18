import { NextResponse } from "next/server";
import { getBearerToken, destroySessionByToken } from "@/lib/session";

/** Revokes the session behind the bearer token used for this request — the app's own sign-out. */
export async function POST() {
  const token = await getBearerToken();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  destroySessionByToken(token);
  return NextResponse.json({ ok: true });
}
