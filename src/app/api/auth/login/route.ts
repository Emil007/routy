import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyLogin } from "@/lib/users";
import { createSession, type SessionUser } from "@/lib/session";
import { checkLockout, recordFailure, clearAttempts } from "@/lib/loginRateLimit";

const bodySchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceName: z.string().trim().max(120).optional(),
});

/**
 * Token-based login for the native app (no cookies, no CAPTCHA widget to render) —
 * relies on the same brute-force lockout as the web login form instead.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { username, password, deviceName } = parsed.data;
  const lockoutKey = `login:${username}`;

  const lockout = checkLockout(lockoutKey);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "locked", retryAfterSeconds: lockout.retryAfterSeconds },
      { status: 429 },
    );
  }

  const user = verifyLogin(username, password);
  if (!user) {
    recordFailure(lockoutKey);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "inactive" }, { status: 403 });
  }
  clearAttempts(lockoutKey);

  const token = await createSession(user.id, { deviceName: deviceName ?? null, client: "app" });
  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    locale: user.locale,
    walkSpeedKmh: user.walkSpeedKmh,
    role: user.role,
    active: user.active,
    theme: user.theme,
  };

  return NextResponse.json({ token, user: sessionUser });
}
