import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listDeletedNodes } from "@/lib/nodes";
import { listDeletedSegments, isCanonicalSegment } from "@/lib/segments";

/** Deleted nodes/segments visible to the current user (admin sees all). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deletedNodes = listDeletedNodes().filter((n) => user.role === "admin" || n.createdBy === user.id);
  const deletedSegments = listDeletedSegments()
    .filter(isCanonicalSegment)
    .filter((s) => user.role === "admin" || s.submittedBy === user.id);

  return NextResponse.json({ deletedNodes, deletedSegments });
}
