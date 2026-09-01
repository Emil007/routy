import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode, setNodeOpeningHours } from "@/lib/nodes";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({
  nodeId: z.number().int().positive(),
  openFromMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  openUntilMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  clear: z.boolean().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node || node.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, node.createdBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  if (parsed.data.clear) {
    setNodeOpeningHours(node.id, { openFromMinutes: null, openUntilMinutes: null });
    logActivity(user.id, "opening_hours_clear", "node", node.id, { name: node.name });
    return NextResponse.json({ ok: true });
  }

  const from = parsed.data.openFromMinutes ?? null;
  const until = parsed.data.openUntilMinutes ?? null;
  if (from == null || until == null) {
    return NextResponse.json({ error: "invalid_hours" }, { status: 400 });
  }

  setNodeOpeningHours(node.id, { openFromMinutes: from, openUntilMinutes: until });
  logActivity(user.id, "opening_hours", "node", node.id, { name: node.name, openFromMinutes: from, openUntilMinutes: until });
  return NextResponse.json({ ok: true, openFromMinutes: from, openUntilMinutes: until });
}
