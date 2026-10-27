import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { assertFreeRoamOwner, checkinFreeRoam } from "@/lib/freeRoam";

const bodySchema = z.object({
  token: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const { token, lat, lng } = parsed.data;

  const access = assertFreeRoamOwner(token, user.id);
  if (access === "missing") return NextResponse.json({ error: "session_expired" }, { status: 410 });
  if (access === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = checkinFreeRoam(token, { lat, lng });
  // Stateless sessions (decision K): every checkin rotates the token. The client
  // MUST store the returned `token` and send it on the next call.
  return NextResponse.json({ ok: true, ...result });
}
