import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createFavorite } from "@/lib/favorites";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  nodeChain: z.array(z.number().int()).min(2),
  segmentIds: z.array(z.number().int()).min(1),
  lengthM: z.number().int().nonnegative(),
  durationMin: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const favorite = createFavorite(user.id, parsed.data.name, {
    nodeChain: parsed.data.nodeChain,
    segmentIds: parsed.data.segmentIds,
    lengthM: parsed.data.lengthM,
    durationMin: parsed.data.durationMin,
  });

  return NextResponse.json({ favorite });
}
