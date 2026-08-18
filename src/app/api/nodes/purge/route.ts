import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode, purgeNode } from "@/lib/nodes";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ nodeId: z.number().int().positive() });

/** Irreversible — permanently removes a node already sitting in trash. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, node.createdBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  purgeNode(node.id);
  logActivity(user.id, "purge", "node", node.id, { name: node.name });
  return NextResponse.json({ ok: true });
}
