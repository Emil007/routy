import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createFavorite } from "@/lib/favorites";

// M1-13/F05/F02: bound the favorite's stored arrays; the length stored on the
// server comes from the segment table (createFavorite ignores client lengthM for
// storage but the API still validates a sane shape).
const MAX_FAVORITE_IDS = 500;
const bodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  nodeChain: z.array(z.number().int()).min(2).max(MAX_FAVORITE_IDS),
  segmentIds: z.array(z.number().int()).min(1).max(MAX_FAVORITE_IDS),
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
