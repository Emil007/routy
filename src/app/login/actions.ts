"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyLogin, tryCreateFirstAdmin } from "@/lib/users";
import { createSession, userCount, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { checkLockout, recordFailure, clearAttempts, getClientIp, IP_LOCKOUT_THRESHOLD } from "@/lib/loginRateLimit";
import { verifyCaptcha, getCaptchaFieldName } from "@/lib/captcha";
import { verifySetupToken } from "@/lib/setupToken";
import { verifyTotpCode } from "@/lib/twoFactor";

async function establishSession(userId: number) {
  const token = await createSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

function captchaToken(formData: FormData): string | null {
  const fieldName = getCaptchaFieldName();
  if (!fieldName) return null;
  return String(formData.get(fieldName) || "") || null;
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const userKey = `login:${username}`;
  const ip = await getClientIp();
  const ipKey = `login-ip:${ip}`;

  const lockout = checkLockout(userKey);
  const ipLockout = checkLockout(ipKey);
  if (lockout.locked || ipLockout.locked) {
    const retry = Math.max(lockout.retryAfterSeconds, ipLockout.retryAfterSeconds);
    redirect(`/login?error=locked&retry=${retry}`);
  }

  if (!(await verifyCaptcha(captchaToken(formData)))) {
    recordFailure(userKey);
    recordFailure(ipKey, IP_LOCKOUT_THRESHOLD);
    redirect("/login?error=captcha");
  }

  const user = verifyLogin(username, password);
  if (!user) {
    recordFailure(userKey);
    recordFailure(ipKey, IP_LOCKOUT_THRESHOLD);
    redirect("/login?error=1");
  }
  if (!user.active) {
    redirect("/login?error=inactive");
  }

  if (user.totpEnabled) {
    const code = String(formData.get("totpCode") || "").trim();
    if (!code) {
      redirect(`/login?totpRequired=1&username=${encodeURIComponent(username)}`);
    }
    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, user.username, code)) {
      recordFailure(userKey);
      recordFailure(ipKey, IP_LOCKOUT_THRESHOLD);
      redirect(`/login?error=totp&username=${encodeURIComponent(username)}`);
    }
  }

  clearAttempts(userKey);
  clearAttempts(ipKey);
  await establishSession(user.id);
  redirect("/route");
}

export async function setupFirstProfileAction(formData: FormData) {
  if (userCount() > 0) {
    redirect("/login");
  }

  const lockout = checkLockout("setup");
  if (lockout.locked) {
    redirect(`/login?setupError=locked&retry=${lockout.retryAfterSeconds}`);
  }

  const setupToken = String(formData.get("setupToken") || "").trim();
  if (!setupToken || !verifySetupToken(setupToken)) {
    recordFailure("setup");
    redirect("/login?setupError=token");
  }

  if (!(await verifyCaptcha(captchaToken(formData)))) {
    recordFailure("setup");
    redirect("/login?setupError=captcha");
  }

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const locale = String(formData.get("locale") || "de") === "en" ? "en" : "de";

  if (!username || password.length < 6) {
    recordFailure("setup");
    redirect("/login?setupError=1");
  }

  const user = tryCreateFirstAdmin(username, password, displayName, locale);
  if (!user) {
    redirect("/login");
  }
  clearAttempts("setup");
  await establishSession(user.id);
  redirect("/route");
}
