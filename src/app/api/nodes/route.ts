import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listNodes } from "@/lib/nodes";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ nodes: listNodes() });
}
