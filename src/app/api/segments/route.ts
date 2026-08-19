import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listSegments } from "@/lib/segments";
import { conditionalJson } from "@/lib/conditionalJson";
import { getNetworkVersion } from "@/lib/networkVersion";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const etag = getNetworkVersion();
  return conditionalJson(request, etag, { segments: listSegments() });
}
