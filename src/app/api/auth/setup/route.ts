import { NextResponse } from "next/server";
import { z } from "zod";
import { tryCreateFirstAdmin } from "@/lib/users";
import { createSession, userCount, type SessionUser } from "@/lib/session";
import { checkLockout, recordFailure, clearAttempts } from "@/lib/loginRateLimit";
import { verifyCaptcha } from "@/lib/captcha";
import { verifySetupToken } from "@/lib/setupToken";

const bodySchema = z.object({
  setupToken: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(6),
  displayName: z.string().trim().max(120).optional(),
  locale: z.enum(["de", "en"]).default("de"),
  deviceName: z.string().trim().max(120).optional(),
  captchaToken: z.string().trim().optional(),
});

/** First-user registration for native app — mirrors web setupFirstProfileAction. */
export async function POST(request: Request) {
  if (userCount() > 0) return NextResponse.json({ error: "already_setup" }, { status: 409 });

  const lockout = checkLockout("setup");
  if (lockout.locked) {
    return NextResponse.json({ error: "locked", retryAfterSeconds: lockout.retryAfterSeconds }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!verifySetupToken(parsed.data.setupToken)) {
    recordFailure("setup");
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

  if (!(await verifyCaptcha(parsed.data.captchaToken ?? null))) {
    recordFailure("setup");
    return NextResponse.json({ error: "captcha_failed" }, { status: 401 });
  }

  const displayName = parsed.data.displayName?.trim() || parsed.data.username;
  const user = tryCreateFirstAdmin(parsed.data.username, parsed.data.password, displayName, parsed.data.locale);
  if (!user) return NextResponse.json({ error: "already_setup" }, { status: 409 });
  clearAttempts("setup");

  const token = await createSession(user.id, { deviceName: parsed.data.deviceName ?? null, client: "app" });
  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    locale: user.locale,
    walkSpeedKmh: null,
    role: "admin",
    active: true,
    theme: "system",
    totpEnabled: false,
    homeNodeId: user.homeNodeId,
    client: "app",
  };

  return NextResponse.json({ token, user: sessionUser });
}
