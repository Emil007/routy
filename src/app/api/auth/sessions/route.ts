import { NextResponse } from "next/server";
import { getCurrentUser, listSessions } from "@/lib/session";

/** Device list for Settings — every browser/app currently signed in, with which one is "you right now". */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ sessions: await listSessions(user.id) });
}
