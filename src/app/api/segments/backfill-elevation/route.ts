import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { backfillMissingElevation } from "@/lib/segments";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await backfillMissingElevation();
  return NextResponse.json(result);
}
