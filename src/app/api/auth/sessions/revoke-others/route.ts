import { NextResponse } from "next/server";
import { getCurrentUser, destroyOtherSessions } from "@/lib/session";

/** Sign out every device except the one making this request. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const revoked = await destroyOtherSessions(user.id);
  return NextResponse.json({ revoked });
}
