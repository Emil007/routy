import { NextResponse } from "next/server";
import { getCurrentUser, createWebViewSession, SESSION_WEB_COOKIE, sessionCookieOptions } from "@/lib/session";

/**
 * M2-5/F11: the Android WebView must never hold the API Bearer in its cookie
 * store. Native Kotlin calls the API with `Authorization: Bearer`; when it needs
 * to open an authenticated web sheet (settings/admin) it calls THIS endpoint with
 * that bearer and receives a fresh, short-lived (15 min) `routy_web` cookie whose
 * session is tagged `webview`. The long-lived API secret never enters the
 * WebView's cookie SQLite. `getCurrentUser` is NOT sufficient here because the
 * WebView hasn't stored the bearer — the Kotlin layer sends it in the header.
 */
export async function POST(_request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const webToken = await createWebViewSession(user.id);
  const response = NextResponse.json({ ok: true, expiresMin: 15 });
  // The Set-Cookie is delivered to the WebView that performed this request —
  // Android's CookieManager stores it for any future request to same origin.
  response.cookies.set(SESSION_WEB_COOKIE, webToken, {
    ...sessionCookieOptions(),
    maxAge: 15 * 60,
  });
  return response;
}
