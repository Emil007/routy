import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getNode, renameNode } from "@/lib/nodes";
import { resolveNamePartsInput } from "@/lib/nameParts";
import { canEdit } from "@/lib/ownership";

const bodySchema = z.object({
  nodeId: z.number().int().positive(),
  part1: z.string().trim().max(255).default(""),
  part2: z.string().trim().max(255).default(""),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const node = getNode(parsed.data.nodeId);
  if (!node || node.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit(user, node.createdBy)) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const { name, nameParts } = resolveNamePartsInput(parsed.data.part1, parsed.data.part2, "/", user.id);
  if (!name) return NextResponse.json({ error: "empty_name" }, { status: 400 });
  renameNode(node.id, name, nameParts);
  return NextResponse.json({ ok: true, name });
}
