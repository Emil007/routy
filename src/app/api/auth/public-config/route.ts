import { NextResponse } from "next/server";
import { userCount } from "@/lib/session";
import { getCaptchaConfig } from "@/lib/captcha";

/**
 * Public login/onboarding bootstrap (not health).
 * Returns only whether first-user setup is needed and captcha widget config —
 * no network size, backup timestamps, or other fingerprinting.
 */
export async function GET() {
  return NextResponse.json({
    needsSetup: userCount() === 0,
    captcha: getCaptchaConfig(),
  });
}
