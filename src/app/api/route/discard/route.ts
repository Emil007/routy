import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { clearActiveRoute } from "@/lib/activeRoute";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  clearActiveRoute(user.id);
  return NextResponse.json({ success: true });
}
