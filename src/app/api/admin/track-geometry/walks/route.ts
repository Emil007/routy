import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listWalkAnalyses, listPendingSegmentSuggestions } from "@/lib/trackGeometry";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 0.57: Analysen werden beim Einspeisen einmalig berechnet und gespeichert —
  // hier wird nur noch aus der DB gelesen (kein O(n²)-Neuberechnen pro Aufruf).
  return NextResponse.json({
    walks: listWalkAnalyses(),
    pending: listPendingSegmentSuggestions(),
  });
}
