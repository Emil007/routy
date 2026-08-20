import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode, setUserHomeNode } from "@/lib/nodes";
import { logActivity } from "@/lib/activityLog";

const bodySchema = z.object({ nodeId: z.number().int().positive() });

/** Sets the current user's home node only — does not affect other users. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node || node.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  setUserHomeNode(user.id, node.id);
  logActivity(user.id, "set_home", "node", node.id, { name: node.name });
  return NextResponse.json({ ok: true, homeNodeId: node.id });
}
