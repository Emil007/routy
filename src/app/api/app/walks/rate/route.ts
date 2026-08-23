import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { setWalkLengthRating } from "@/lib/lengthTaste";

const bodySchema = z.object({
  walkId: z.number().int().positive(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const ok = setWalkLengthRating(parsed.data.walkId, user.id, parsed.data.rating);
  if (!ok) return NextResponse.json({ error: "walk_not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
