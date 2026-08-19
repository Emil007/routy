import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().trim().max(50000).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  db.prepare("INSERT INTO crash_report (user_id, message, stack, app_version) VALUES (?, ?, ?, ?)").run(
    user.id,
    parsed.data.message,
    parsed.data.stack ?? null,
    parsed.data.appVersion ?? null,
  );

  return NextResponse.json({ ok: true });
}
