import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { suggestNodeNameParts } from "@/lib/nodeNaming";

const bodySchema = z.object({ lat: z.number(), lng: z.number() });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const suggestions = await suggestNodeNameParts({ lat: parsed.data.lat, lng: parsed.data.lng });
  return NextResponse.json(suggestions);
}
