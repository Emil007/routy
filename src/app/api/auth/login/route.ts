import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyLogin } from "@/lib/users";
import { createSession, type SessionUser } from "@/lib/session";
import { checkLockout, recordFailure, clearAttempts, getClientIp, IP_LOCKOUT_THRESHOLD } from "@/lib/loginRateLimit";
import { verifyTotpCode } from "@/lib/twoFactor";
import { verifyCaptcha } from "@/lib/captcha";

const bodySchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceName: z.string().trim().max(120).optional(),
  totpCode: z.string().trim().optional(),
  captchaToken: z.string().trim().optional(),
});

/**
 * Token-based login for the native Android app (Bearer auth). Sessions are tagged
 * `client: "app"` so the admin WebView can hide NavBar chrome; native tabs do not load these pages.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { username, password, deviceName, totpCode, captchaToken } = parsed.data;
  const lockoutKey = `login:${username}`;
  const ip = await getClientIp();
  const ipLockoutKey = `login-ip:${ip}`;

  const lockout = checkLockout(lockoutKey);
  const ipLockout = checkLockout(ipLockoutKey);
  if (lockout.locked || ipLockout.locked) {
    return NextResponse.json(
      { error: "locked", retryAfterSeconds: Math.max(lockout.retryAfterSeconds, ipLockout.retryAfterSeconds) },
      { status: 429 },
    );
  }

  if (!(await verifyCaptcha(captchaToken ?? null))) {
    recordFailure(lockoutKey);
    recordFailure(ipLockoutKey, IP_LOCKOUT_THRESHOLD);
    return NextResponse.json({ error: "captcha_failed" }, { status: 401 });
  }

  const user = verifyLogin(username, password);
  if (!user) {
    recordFailure(lockoutKey);
    recordFailure(ipLockoutKey, IP_LOCKOUT_THRESHOLD);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "inactive" }, { status: 403 });
  }

  if (user.totpEnabled) {
    if (!totpCode) return NextResponse.json({ error: "totp_required" }, { status: 401 });
    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, user.username, totpCode)) {
      recordFailure(lockoutKey);
      recordFailure(ipLockoutKey, IP_LOCKOUT_THRESHOLD);
      return NextResponse.json({ error: "invalid_totp" }, { status: 401 });
    }
  }

  clearAttempts(lockoutKey);
  clearAttempts(ipLockoutKey);

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
    totpEnabled: user.totpEnabled,
    homeNodeId: user.homeNodeId,
    client: "app",
  };

  return NextResponse.json({ token, user: sessionUser });
}
