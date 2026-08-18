import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode, setHomeNode } from "@/lib/nodes";

const bodySchema = z.object({ nodeId: z.number().int().positive() });

/** Sets the shared network "home" node — not owner-scoped, any signed-in user may change it. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node) return NextResponse.json({ error: "not_found" }, { status: 404 });

  setHomeNode(node.id);
  return NextResponse.json({ ok: true });
}
