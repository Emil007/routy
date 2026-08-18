import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

/** Lets the app validate a stored token and refresh its cached profile on startup. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ user });
}
