import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Nonce-based CSP so Next's own inline hydration scripts keep working without
// falling back to 'unsafe-inline' (which would defeat most of the point).
// Next automatically applies this nonce to the scripts/styles it injects
// itself, once it sees the header below — see
// https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const secure =
    process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

  // style-src stays 'unsafe-inline': a nonce only covers <style> blocks, not
  // React's style={{...}} attributes, which this app uses throughout — and a
  // nonce alongside 'unsafe-inline' would make browsers ignore the latter
  // anyway. script-src is where CSP's injection protection actually matters.
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https://tile.openstreetmap.org https://*.tile.opentopomap.org https://server.arcgisonline.com https://tile.waymarkedtrails.org;
    font-src 'self';
    connect-src 'self';
    frame-src https://challenges.cloudflare.com https://newassets.hcaptcha.com https://www.google.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'self';
    ${secure ? "upgrade-insecure-requests;" : ""}
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "geolocation=(self), microphone=(), camera=()");
  if (secure) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's static assets, the manifest, icons and the service worker.
    "/((?!_next/static|_next/image|manifest.json|sw.js|icons/).*)",
  ],
};
